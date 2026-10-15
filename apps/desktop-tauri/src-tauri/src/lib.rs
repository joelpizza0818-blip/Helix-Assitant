use std::{
    collections::HashMap,
    fs,
    future::Future,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{SinkExt, StreamExt};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tokio::{
    process::{Child, Command},
    sync::{mpsc, oneshot, watch, Mutex},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        client::IntoClientRequest,
        http::{
            header::{HeaderValue, AUTHORIZATION},
            Request,
        },
        Message,
    },
};

const DEFAULT_AGENT_PORT: u16 = 8765;
const MAX_PENDING_REQUESTS: usize = 64;
const AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const ADMIN_API: &str = "https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-admin";
const LITE_UPDATES_API: &str =
    "https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-lite-updates";
const LITE_RELEASE_REPOSITORY: &str = "joelpizza0818-blip/Helix-Assitant";
const LITE_INSTALLER_ASSET: &str = "HELIX-Lite-Setup.exe";
const CAPABILITY_CATALOG_URL: &str =
    "https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/catalog.json";
const CAPABILITY_ASSET_BASE: &str =
    "https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/";
const MAX_CAPABILITY_PACK_BYTES: usize = 16 * 1024 * 1024;
static CAPABILITY_OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct AgentRuntime {
    child: Option<Child>,
    outgoing: Option<mpsc::Sender<String>>,
    pending: HashMap<String, oneshot::Sender<Result<Value, String>>>,
    request_sequence: u64,
}

#[derive(Clone, Default)]
struct AgentBridge(Arc<Mutex<AgentRuntime>>);

#[derive(Default)]
struct UpdaterState(Mutex<Option<PathBuf>>);

#[derive(Clone, Default)]
struct CapabilityDownloads(Arc<Mutex<HashMap<String, CapabilityDownloadOperation>>>);

struct CapabilityDownloadOperation {
    id: u64,
    abort: tokio::task::AbortHandle,
    result: watch::Sender<Option<Result<Value, String>>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiteReleaseInfo {
    version: String,
    tag: String,
    installer_url: String,
    checksum_url: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityPackManifest {
    id: String,
    version: String,
    capability: String,
    format: String,
    required_for_complete: bool,
    platform: String,
    arch: String,
    core_version_range: String,
    size_bytes: usize,
    url: String,
    sha256: String,
    signature: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SignedCapabilityCatalog {
    version: u32,
    packs: Vec<CapabilityPackManifest>,
    signature: String,
}

fn is_newer_version(candidate: &str, current: &str) -> bool {
    let numbers = |version: &str| {
        version
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let candidate = numbers(candidate);
    let current = numbers(current);
    (0..candidate.len().max(current.len()))
        .map(|index| {
            (
                candidate.get(index).copied().unwrap_or(0),
                current.get(index).copied().unwrap_or(0),
            )
        })
        .find(|(left, right)| left != right)
        .is_some_and(|(left, right)| left > right)
}

fn is_trusted_release_asset(url_value: &str, version: &str, asset: &str) -> bool {
    let expected_path =
        format!("/{LITE_RELEASE_REPOSITORY}/releases/download/lite-v{version}/{asset}");
    reqwest::Url::parse(url_value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("github.com")
            && url.path() == expected_path
    })
}

fn is_valid_release_version(version: &str) -> bool {
    version.split('.').count() == 3
        && version
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

async fn latest_lite_release() -> Result<LiteReleaseInfo, String> {
    let release = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Could not initialize the HELIX Lite updater: {error}"))?
        .get(LITE_UPDATES_API)
        .header("User-Agent", "HELIX-Lite-Updater")
        .send()
        .await
        .map_err(|error| format!("Could not check the HELIX Lite release policy: {error}"))?
        .error_for_status()
        .map_err(|error| format!("HELIX Lite release policy rejected the request: {error}"))?
        .json::<LiteReleaseInfo>()
        .await
        .map_err(|error| format!("Invalid HELIX Lite release policy: {error}"))?;
    if !is_valid_release_version(&release.version)
        || release.tag != format!("lite-v{}", release.version)
        || !is_trusted_release_asset(
            &release.installer_url,
            &release.version,
            LITE_INSTALLER_ASSET,
        )
        || !is_trusted_release_asset(
            &release.checksum_url,
            &release.version,
            &format!("{LITE_INSTALLER_ASSET}.sha256"),
        )
    {
        return Err(
            "HELIX Lite release policy returned an invalid or untrusted release".to_string(),
        );
    }
    Ok(release)
}

fn create_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| "Could not create agent authentication token".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn available_loopback_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", DEFAULT_AGENT_PORT))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("Could not reserve a local agent port: {error}"))
}

fn resolve_agent_dir(
    manifest_dir: &Path,
    resource_dir: Option<&Path>,
    bundled_agent: Option<&Path>,
) -> Option<PathBuf> {
    let development_agent = manifest_dir.join("../../../services/agent");
    if development_agent.join("main.py").is_file() {
        return Some(development_agent);
    }

    let source_agent = resource_dir
        .map(|root| [root.join("agent"), root.join("services/agent")])
        .into_iter()
        .flatten()
        .find(|candidate| candidate.join("main.py").is_file());
    source_agent.or_else(|| bundled_agent.and_then(Path::parent).map(Path::to_path_buf))
}

fn python_candidates(agent_dir: &Path, project_root: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        agent_dir.join(".venv/Scripts/python.exe"),
        project_root.join(".venv/Scripts/python.exe"),
        agent_dir.join(".venv/bin/python"),
        project_root.join(".venv/bin/python"),
    ]
    .into_iter()
    .filter(|candidate| candidate.is_file())
    .collect::<Vec<_>>();
    candidates.push(PathBuf::from(if cfg!(windows) {
        "python"
    } else {
        "python3"
    }));
    if cfg!(windows) {
        candidates.push(PathBuf::from("py"));
    }
    candidates
}

fn event_channel(event_type: &str) -> String {
    match event_type {
        "agent_message" => "helix:agent-message",
        "task_update" => "helix:task-update",
        "status_update" => "helix:status-update",
        "fallback_event" => "helix:fallback-event",
        "confirmation_request" => "helix:confirmation-request",
        "confirmation_resolved" => "helix:confirmation-resolved",
        "error" => "helix:error",
        "provider_update" => "helix:provider-update",
        "model_update" => "helix:model-update",
        "hand_landmarks" => "helix:hand-landmarks",
        "capability-required" => "helix:capability-required",
        "voice_capture_started" => "helix:voice_capture_started",
        "voice_capture_stopped" => "helix:voice_capture_stopped",
        "settings_applied" => "helix:settings-applied",
        other => return format!("helix:{other}"),
    }
    .to_string()
}

fn is_supported_request(message_type: &str) -> bool {
    matches!(
        message_type,
        "GET_TASKS"
            | "GET_PROVIDERS"
            | "GET_MODELS"
            | "GET_SETTINGS"
            | "SAVE_SETTINGS"
            | "TEST_TTS"
            | "GET_MEMORY_STATUS"
            | "CLEAR_MEMORY"
            | "VALIDATE_KEY"
            | "GET_SKILLS"
            | "SAVE_SKILL"
            | "DELETE_SKILL"
            | "GET_MCP_SERVERS"
    )
}

fn is_supported_event(message_type: &str) -> bool {
    matches!(
        message_type,
        "USER_TEXT"
            | "TASK_CANCEL"
            | "TASK_CANCEL_ALL"
            | "CONFIRMATION_GRANTED"
            | "CONFIRMATION_REJECTED"
            | "CAPABILITY_RESOLVED"
    )
}

fn authenticated_request(url: &str, token: &str) -> Result<Request<()>, String> {
    let mut request = url
        .into_client_request()
        .map_err(|error| format!("Invalid local agent WebSocket URL: {error}"))?;
    let value = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| "Could not create agent authentication header".to_string())?;
    request.headers_mut().insert(AUTHORIZATION, value);
    Ok(request)
}

async fn start_agent_inner(app: AppHandle, bridge: AgentBridge) -> Result<(), String> {
    {
        let runtime = bridge.0.lock().await;
        if runtime.outgoing.is_some() {
            return Ok(());
        }
        if runtime.child.is_some() {
            return Err("The Python agent is already starting".to_string());
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let resource_dir = app.path().resource_dir().ok();
    let bundled_agent = resource_dir
        .as_ref()
        .map(|root| root.join("agent-runtime/helix-agent.exe"))
        .filter(|candidate| candidate.is_file());
    let agent_dir = resolve_agent_dir(
        &manifest_dir,
        resource_dir.as_deref(),
        bundled_agent.as_deref(),
    )
    .ok_or_else(|| "Python agent files were not found beside the app resources".to_string())?;
    let project_root = agent_dir
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "Could not determine the HELIX project directory".to_string())?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve HELIX data directory: {error}"))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Could not create HELIX data directory: {error}"))?;
    let settings_path = app_data_dir.join("settings.json");
    let port = available_loopback_port()?;
    let token = create_token()?;

    let python_path = std::env::var_os("PYTHONPATH")
        .map(|existing| {
            let mut paths = vec![project_root.to_path_buf()];
            paths.extend(std::env::split_paths(&existing));
            std::env::join_paths(paths)
        })
        .and_then(Result::ok)
        .unwrap_or_else(|| project_root.as_os_str().to_os_string());
    let launch_candidates = if let Some(executable) = bundled_agent {
        vec![(executable, vec![format!("--ws-port={port}")])]
    } else {
        python_candidates(&agent_dir, project_root)
            .into_iter()
            .map(|python| {
                (
                    python,
                    vec![
                        "main.py".to_string(),
                        "--ws-port".to_string(),
                        port.to_string(),
                    ],
                )
            })
            .collect()
    };
    let mut child = None;
    let mut last_spawn_error = None;
    for (executable, args) in launch_candidates {
        let mut command = Command::new(&executable);
        command
            .args(args)
            .current_dir(&agent_dir)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .env("HELIX_SETTINGS_PATH", &settings_path)
            .env("HELIX_WS_TOKEN", &token)
            .env("HELIX_CAMERA_ENABLED_BY_DEFAULT", "true")
            .env("PYTHONPATH", &python_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.as_std_mut().creation_flags(0x08000000);
        }

        match command.spawn() {
            Ok(process) => {
                child = Some(process);
                break;
            }
            Err(error) => last_spawn_error = Some(error),
        }
    }
    let child = child.ok_or_else(|| {
        format!(
            "Could not start the Python agent: {}",
            last_spawn_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "no Python executable was available".to_string())
        )
    })?;
    {
        let mut runtime = bridge.0.lock().await;
        runtime.child = Some(child);
    }

    let url = format!("ws://127.0.0.1:{port}");
    let request = authenticated_request(&url, &token)?;
    let deadline = tokio::time::Instant::now() + AGENT_READY_TIMEOUT;
    let socket = loop {
        if tokio::time::Instant::now() >= deadline {
            stop_agent_inner(&bridge).await;
            return Err(format!(
                "Python agent WebSocket did not become ready on port {port}"
            ));
        }

        {
            let mut runtime = bridge.0.lock().await;
            if let Some(child) = runtime.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        runtime.child = None;
                        return Err(format!("Python agent exited during startup ({status})"));
                    }
                    Err(error) => {
                        runtime.child = None;
                        return Err(format!("Could not inspect Python agent process: {error}"));
                    }
                    Ok(None) => {}
                }
            } else {
                return Err("Python agent stopped during startup".to_string());
            }
        }

        match tokio::time::timeout(Duration::from_millis(750), connect_async(request.clone())).await
        {
            Ok(Ok((socket, _))) => break socket,
            _ => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    };

    let (outgoing, receiver) = mpsc::channel(64);
    bridge.0.lock().await.outgoing = Some(outgoing);
    let _ = app.emit("helix:agent-status", json!({ "status": "ready" }));
    tokio::spawn(run_websocket(app, bridge.clone(), socket, receiver));
    Ok(())
}

async fn run_websocket(
    app: AppHandle,
    bridge: AgentBridge,
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    mut outgoing: mpsc::Receiver<String>,
) {
    let (mut writer, mut reader) = socket.split();
    loop {
        tokio::select! {
            outbound = outgoing.recv() => {
                let Some(outbound) = outbound else { break };
                if writer.send(Message::Text(outbound.into())).await.is_err() {
                    break;
                }
            }
            incoming = reader.next() => {
                let Some(Ok(frame)) = incoming else { break };
                let text = match frame {
                    Message::Text(text) => text,
                    Message::Ping(payload) => {
                        if writer.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    Message::Pong(_) | Message::Frame(_) => continue,
                    Message::Close(_) | Message::Binary(_) => break,
                };
                let Ok(message) = serde_json::from_str::<Value>(&text) else { continue };

                if let Some(request_id) = message.get("request_id").and_then(Value::as_str) {
                    let sender = bridge.0.lock().await.pending.remove(request_id);
                    if let Some(sender) = sender {
                        let result = if let Some(error) = message.get("error").and_then(Value::as_str) {
                            Err(error.to_string())
                        } else {
                            Ok(message.get("payload").cloned().unwrap_or(Value::Null))
                        };
                        let _ = sender.send(result);
                        continue;
                    }
                }

                let event_type = message.get("type").and_then(Value::as_str).unwrap_or("message");
                let payload = message.get("payload").cloned().unwrap_or(Value::Null);
                if event_type == "capability-required" {
                    let request_id = payload.get("request_id").and_then(Value::as_str).unwrap_or("").to_string();
                    let capability = payload.get("capability").and_then(Value::as_str).unwrap_or("").to_string();
                    let app = app.clone();
                    let bridge = bridge.clone();
                    tokio::spawn(async move {
                        let result = async {
                            if request_id.is_empty() || capability.is_empty() {
                                return Err("Capability request is missing its request id or capability.".to_string());
                            }
                            let pack_id = if let Some(pack_id) = cached_installed_capability_pack_id(&app, &capability) {
                                pack_id
                            } else {
                                let catalog = verified_capability_catalog(&app).await?;
                                catalog.packs.iter()
                                    .find(|pack| pack.capability == capability)
                                    .map(|manifest| manifest.id.clone())
                                    .ok_or_else(|| format!("No signed capability pack provides {capability}."))?
                            };
                            let downloads = app.state::<CapabilityDownloads>().inner().clone();
                            install_capability_managed(&app, &bridge, &downloads, &pack_id).await
                        }.await;
                        let resolved = match result {
                            Ok(_) => json!({
                                "request_id": request_id,
                                "capability": capability,
                                "status": "installed"
                            }),
                            Err(error) => json!({
                                "request_id": request_id,
                                "capability": capability,
                                "status": "error",
                                "error": error
                            }),
                        };
                        let _ = send_agent_message(&bridge, "CAPABILITY_RESOLVED", resolved, None).await;
                    });
                }
                let _ = app.emit(&event_channel(event_type), payload);
            }
        }
    }

    {
        let mut runtime = bridge.0.lock().await;
        runtime.outgoing = None;
        for (_, pending) in runtime.pending.drain() {
            let _ = pending.send(Err("Python agent WebSocket disconnected".to_string()));
        }
    }
    let _ = app.emit("helix:agent-status", json!({ "status": "disconnected" }));
}

async fn stop_agent_inner(bridge: &AgentBridge) {
    let child = {
        let mut runtime = bridge.0.lock().await;
        runtime.outgoing = None;
        for (_, pending) in runtime.pending.drain() {
            let _ = pending.send(Err("Python agent stopped".to_string()));
        }
        runtime.child.take()
    };
    if let Some(mut child) = child {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
async fn start_agent(app: AppHandle, bridge: State<'_, AgentBridge>) -> Result<(), String> {
    start_agent_inner(app, bridge.inner().clone()).await
}

#[tauri::command]
async fn stop_agent(bridge: State<'_, AgentBridge>) -> Result<(), String> {
    stop_agent_inner(bridge.inner()).await;
    Ok(())
}

#[tauri::command]
async fn agent_send(
    bridge: State<'_, AgentBridge>,
    message_type: String,
    payload: Value,
) -> Result<(), String> {
    if !is_supported_event(&message_type) {
        return Err(format!("Unsupported agent event: {message_type}"));
    }
    send_agent_message(bridge.inner(), &message_type, payload, None).await
}

#[tauri::command]
async fn agent_request(
    bridge: State<'_, AgentBridge>,
    message_type: String,
    payload: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    if !is_supported_request(&message_type) {
        return Err(format!("Unsupported agent request: {message_type}"));
    }
    request_agent_inner(bridge.inner(), &message_type, payload, timeout_ms).await
}

async fn request_agent_inner(
    bridge: &AgentBridge,
    message_type: &str,
    payload: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let (request_id, response) = {
        let mut runtime = bridge.0.lock().await;
        if runtime.outgoing.is_none() {
            return Err("Python agent is not connected".to_string());
        }
        if runtime.pending.len() >= MAX_PENDING_REQUESTS {
            return Err("Too many pending Python agent requests".to_string());
        }
        runtime.request_sequence += 1;
        let request_id = format!("tauri_{}", runtime.request_sequence);
        let (sender, receiver) = oneshot::channel();
        runtime.pending.insert(request_id.clone(), sender);
        (request_id, receiver)
    };

    if let Err(error) =
        send_agent_message(bridge, message_type, payload, Some(request_id.clone())).await
    {
        bridge.0.lock().await.pending.remove(&request_id);
        return Err(error);
    }

    let result = match tokio::time::timeout(
        Duration::from_millis(timeout_ms.unwrap_or(REQUEST_TIMEOUT.as_millis() as u64)),
        response,
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Python agent request was cancelled".to_string()),
        Err(_) => {
            bridge.0.lock().await.pending.remove(&request_id);
            Err(format!("Request timeout: {message_type}"))
        }
    }?;
    Ok(result)
}

fn canonical_json(value: &Value) -> Result<String, String> {
    match value {
        Value::Array(values) => Ok(format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Result<Vec<_>, _>>()?
                .join(",")
        )),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            let entries = keys
                .into_iter()
                .map(|key| {
                    Ok(format!(
                        "{}:{}",
                        serde_json::to_string(key).map_err(|error| format!(
                            "Could not canonicalize catalog key: {error}"
                        ))?,
                        canonical_json(&values[key])?
                    ))
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok(format!("{{{}}}", entries.join(",")))
        }
        _ => serde_json::to_string(value)
            .map_err(|error| format!("Could not canonicalize signed content: {error}")),
    }
}

fn capability_public_key() -> Result<Vec<u8>, String> {
    let encoded = option_env!("HELIX_CAPABILITY_PUBLIC_KEY")
        .ok_or_else(|| "HELIX Lite was built without a capability trust key.".to_string())?;
    let key = BASE64
        .decode(encoded)
        .map_err(|_| "HELIX Lite capability trust key is not valid Base64.".to_string())?;
    if key.len() != 32 {
        return Err("HELIX Lite capability trust key must contain 32 bytes.".to_string());
    }
    Ok(key)
}

fn verify_capability_signature(value: &Value, signature: &str) -> Result<(), String> {
    let key = capability_public_key()?;
    let signature = BASE64
        .decode(signature)
        .map_err(|_| "Capability signature is not valid Base64.".to_string())?;
    let message = canonical_json(value)?;
    UnparsedPublicKey::new(&ED25519, &key)
        .verify(message.as_bytes(), &signature)
        .map_err(|_| "Capability signature verification failed.".to_string())
}

fn verify_capability_catalog(catalog: &SignedCapabilityCatalog) -> Result<(), String> {
    if catalog.version != 1 {
        return Err("Unsupported capability catalog version.".to_string());
    }
    let catalog_value = serde_json::to_value(catalog)
        .map_err(|error| format!("Could not parse capability catalog: {error}"))?;
    let mut unsigned_catalog = catalog_value.clone();
    unsigned_catalog
        .as_object_mut()
        .ok_or_else(|| "Capability catalog is invalid.".to_string())?
        .remove("signature");
    verify_capability_signature(&unsigned_catalog, &catalog.signature)?;

    for manifest in &catalog.packs {
        if !is_safe_pack_id(&manifest.id)
            || !valid_pack_version(&manifest.version)
            || manifest.format != "python-plugin"
            || manifest.capability.is_empty()
            || manifest.platform != "win32"
            || manifest.arch != "x64"
            || manifest.size_bytes == 0
            || manifest.size_bytes > MAX_CAPABILITY_PACK_BYTES
            || manifest.sha256.len() != 64
            || !manifest.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !manifest.url.starts_with(CAPABILITY_ASSET_BASE)
            || manifest.signature.is_empty()
        {
            return Err(format!(
                "Capability pack {} has invalid signed metadata.",
                manifest.id
            ));
        }
        let mut unsigned_manifest = serde_json::to_value(manifest)
            .map_err(|error| format!("Could not parse capability manifest: {error}"))?;
        unsigned_manifest
            .as_object_mut()
            .ok_or_else(|| "Capability manifest is invalid.".to_string())?
            .remove("signature");
        verify_capability_signature(&unsigned_manifest, &manifest.signature)?;
    }
    Ok(())
}

fn is_safe_pack_id(id: &str) -> bool {
    let mut bytes = id.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    id.len() <= 64
        && (first.is_ascii_lowercase() || first.is_ascii_digit())
        && bytes.all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
}

fn valid_pack_version(version: &str) -> bool {
    let parts = version.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

fn capability_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("capabilities"))
        .map_err(|error| format!("Could not resolve HELIX capability directory: {error}"))
}

fn installation_profile(app: &AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve HELIX data directory: {error}"))?
        .join("installation-profile.json");
    let profile = fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|value| {
            value
                .get("profile")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .filter(|profile| matches!(profile.as_str(), "complete" | "progressive"))
        .unwrap_or_else(|| "complete".to_string());
    Ok(profile)
}

async fn fetch_capability_catalog(app: &AppHandle) -> Result<SignedCapabilityCatalog, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Could not initialize capability catalog client: {error}"))?;
    let response = client
        .get(CAPABILITY_CATALOG_URL)
        .send()
        .await
        .map_err(|error| format!("Could not download capability catalog: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Capability catalog returned HTTP {}.",
            response.status()
        ));
    }
    let catalog: SignedCapabilityCatalog = response
        .json()
        .await
        .map_err(|error| format!("Capability catalog is invalid JSON: {error}"))?;
    verify_capability_catalog(&catalog)?;
    let directory = capability_data_dir(app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create capability directory: {error}"))?;
    let bytes = serde_json::to_vec_pretty(&catalog)
        .map_err(|error| format!("Could not serialize verified catalog: {error}"))?;
    fs::write(directory.join("catalog.json"), bytes)
        .map_err(|error| format!("Could not cache verified catalog: {error}"))?;
    Ok(catalog)
}

fn read_cached_catalog(app: &AppHandle) -> Result<SignedCapabilityCatalog, String> {
    let path = capability_data_dir(app)?.join("catalog.json");
    let bytes = fs::read(path)
        .map_err(|error| format!("No verified capability catalog is cached: {error}"))?;
    let catalog: SignedCapabilityCatalog = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Cached capability catalog is invalid: {error}"))?;
    verify_capability_catalog(&catalog)?;
    Ok(catalog)
}

async fn verified_capability_catalog(app: &AppHandle) -> Result<SignedCapabilityCatalog, String> {
    match fetch_capability_catalog(app).await {
        Ok(catalog) => Ok(catalog),
        Err(network_error) => match read_cached_catalog(app) {
            Ok(catalog) => Ok(catalog),
            Err(cache_error) => Err(format!("{network_error} {cache_error}")),
        },
    }
}

fn installed_pack_path(
    app: &AppHandle,
    manifest: &CapabilityPackManifest,
) -> Result<PathBuf, String> {
    if !is_safe_pack_id(&manifest.id) || !valid_pack_version(&manifest.version) {
        return Err("Capability pack path is invalid.".to_string());
    }
    Ok(capability_data_dir(app)?
        .join("packs")
        .join(&manifest.id)
        .join(format!("{}.py", manifest.version)))
}

fn hash_file(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(format!("{:x}", Sha256::digest(bytes)))
}

fn installed_pack_matches(path: &Path, manifest: &CapabilityPackManifest) -> bool {
    hash_file(path).is_some_and(|hash| hash.eq_ignore_ascii_case(&manifest.sha256))
}

fn cached_installed_capability_pack_id(app: &AppHandle, capability: &str) -> Option<String> {
    let catalog = read_cached_catalog(app).ok()?;
    let manifest = catalog
        .packs
        .iter()
        .find(|manifest| manifest.capability == capability && pack_is_compatible(manifest))?;
    let path = installed_pack_path(app, manifest).ok()?;
    installed_pack_matches(&path, manifest).then(|| manifest.id.clone())
}

fn pack_is_compatible(manifest: &CapabilityPackManifest) -> bool {
    let range = manifest.core_version_range.trim();
    if range == "*" || range.is_empty() {
        return true;
    }
    let Some(current) = parse_semver(env!("CARGO_PKG_VERSION")) else {
        return false;
    };
    range.split_whitespace().all(|constraint| {
        let (operator, version) = ["^", "~", ">=", "<=", ">", "<", "="]
            .iter()
            .find_map(|operator| {
                constraint
                    .strip_prefix(operator)
                    .map(|version| (*operator, version))
            })
            .unwrap_or(("=", constraint));
        let Some(target) = parse_semver(version) else {
            return false;
        };
        let ordering = current.cmp(&target);
        match operator {
            "^" => {
                let compatible = if target[0] > 0 {
                    current[0] == target[0]
                } else if target[1] > 0 {
                    current[0] == 0 && current[1] == target[1]
                } else {
                    current[0] == 0 && current[1] == 0 && current[2] == target[2]
                };
                ordering.is_ge() && compatible
            }
            "~" => ordering.is_ge() && current[0] == target[0] && current[1] == target[1],
            ">=" => ordering.is_ge(),
            "<=" => ordering.is_le(),
            ">" => ordering.is_gt(),
            "<" => ordering.is_lt(),
            _ => ordering.is_eq(),
        }
    })
}

fn parse_semver(value: &str) -> Option<[u64; 3]> {
    let core = value
        .trim()
        .trim_start_matches('v')
        .split(['-', '+'])
        .next()?;
    let parts = core.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return None;
    }
    Some([
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ])
}

#[tauri::command]
async fn get_capabilities(app: AppHandle) -> Result<Value, String> {
    let profile = installation_profile(&app)?;
    let catalog = verified_capability_catalog(&app).await?;
    capability_snapshot(&app, profile, &catalog)
}

fn capability_snapshot(
    app: &AppHandle,
    profile: String,
    catalog: &SignedCapabilityCatalog,
) -> Result<Value, String> {
    let packs = catalog.packs.iter().map(|manifest| {
        let path = installed_pack_path(&app, manifest).ok();
        let installed = path.as_deref().is_some_and(|path| installed_pack_matches(path, manifest));
        let compatible = pack_is_compatible(manifest);
        let status = if !compatible { "incompatible" } else if installed { "installed" } else { "missing" };
        json!({
            "id": manifest.id,
            "version": manifest.version,
            "capability": manifest.capability,
            "format": manifest.format,
            "requiredForComplete": manifest.required_for_complete,
            "platform": manifest.platform,
            "arch": manifest.arch,
            "coreVersionRange": manifest.core_version_range,
            "sizeBytes": manifest.size_bytes,
            "url": manifest.url,
            "sha256": manifest.sha256,
            "signature": manifest.signature,
            "status": status,
            "installedPath": if installed { path.map(|value| value.to_string_lossy().into_owned()) } else { None::<String> }
        })
    }).collect::<Vec<_>>();
    let missing_count = packs
        .iter()
        .filter(|pack| pack["status"] != "installed")
        .count();
    let required_missing_count = packs
        .iter()
        .filter(|pack| pack["requiredForComplete"] == true && pack["status"] != "installed")
        .count();
    Ok(json!({
        "profile": profile,
        "packs": packs,
        "missingCount": missing_count,
        "requiredMissingCount": required_missing_count,
        "ready": required_missing_count == 0
    }))
}

#[tauri::command]
async fn set_installation_profile(app: AppHandle, profile: String) -> Result<Value, String> {
    if !matches!(profile.as_str(), "complete" | "progressive") {
        return Err("Unsupported HELIX Lite installation profile".to_string());
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve HELIX data directory: {error}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Could not create HELIX data directory: {error}"))?;
    fs::write(
        data_dir.join("installation-profile.json"),
        serde_json::to_vec(&json!({ "profile": profile }))
            .map_err(|error| format!("Could not save installation profile: {error}"))?,
    )
    .map_err(|error| format!("Could not save installation profile: {error}"))?;
    get_capabilities(app).await
}

#[tauri::command]
async fn install_capability(
    app: AppHandle,
    bridge: State<'_, AgentBridge>,
    downloads: State<'_, CapabilityDownloads>,
    pack_id: String,
) -> Result<Value, String> {
    install_capability_managed(&app, bridge.inner(), downloads.inner(), &pack_id).await
}

async fn install_capability_managed(
    app: &AppHandle,
    bridge: &AgentBridge,
    downloads: &CapabilityDownloads,
    pack_id: &str,
) -> Result<Value, String> {
    let app = app.clone();
    let bridge = bridge.clone();
    let operation_pack_id = pack_id.to_string();
    let key = operation_pack_id.clone();
    coalesce_capability_operation(downloads, key, move || async move {
        install_capability_inner(&app, &bridge, &operation_pack_id).await
    })
    .await
}

async fn coalesce_capability_operation<F, Fut>(
    downloads: &CapabilityDownloads,
    pack_id: String,
    operation: F,
) -> Result<Value, String>
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = Result<Value, String>> + Send + 'static,
{
    let receiver = {
        let mut active = downloads.0.lock().await;
        if let Some(existing) = active.get(&pack_id) {
            existing.result.subscribe()
        } else {
            let operation_id = CAPABILITY_OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let (result, receiver) = watch::channel(None);
            let task_result = result.clone();
            let active_downloads = downloads.clone();
            let task_pack_id = pack_id.clone();
            let task = tokio::spawn(async move {
                let result_value = operation().await;
                let mut active = active_downloads.0.lock().await;
                if active.get(&task_pack_id).map(|item| item.id) == Some(operation_id) {
                    let _ = task_result.send(Some(result_value));
                    active.remove(&task_pack_id);
                }
            });
            active.insert(
                pack_id,
                CapabilityDownloadOperation {
                    id: operation_id,
                    abort: task.abort_handle(),
                    result,
                },
            );
            receiver
        }
    };
    await_capability_operation(receiver).await
}

async fn await_capability_operation(
    mut receiver: watch::Receiver<Option<Result<Value, String>>>,
) -> Result<Value, String> {
    loop {
        if let Some(result) = receiver.borrow().clone() {
            return result;
        }
        receiver
            .changed()
            .await
            .map_err(|_| "Capability installation ended without a result.".to_string())?;
    }
}

async fn cancel_capability_operation(downloads: &CapabilityDownloads, pack_id: &str) -> bool {
    let operation = {
        let mut active = downloads.0.lock().await;
        if active
            .get(pack_id)
            .is_some_and(|operation| operation.result.borrow().is_none())
        {
            active.remove(pack_id)
        } else {
            None
        }
    };
    if let Some(operation) = operation {
        let _ = operation.result.send(Some(Err(
            "Capability installation was canceled.".to_string()
        )));
        operation.abort.abort();
        true
    } else {
        false
    }
}

async fn install_capability_inner(
    app: &AppHandle,
    bridge: &AgentBridge,
    pack_id: &str,
) -> Result<Value, String> {
    if !is_safe_pack_id(&pack_id) {
        return Err("Capability pack id is invalid.".to_string());
    }
    let profile = installation_profile(app)?;
    if profile != "progressive" {
        return Err(
            "Capability packs can only be installed on demand in a progressive installation."
                .to_string(),
        );
    }
    if let Ok(cached_catalog) = read_cached_catalog(app) {
        if let Some(manifest) = cached_catalog
            .packs
            .iter()
            .find(|manifest| manifest.id == pack_id && pack_is_compatible(manifest))
        {
            let destination = installed_pack_path(app, manifest)?;
            if installed_pack_matches(&destination, manifest) {
                request_agent_inner(
                    bridge,
                    "LOAD_CAPABILITY_PACK",
                    json!({
                        "id": manifest.id,
                        "version": manifest.version,
                        "sha256": manifest.sha256
                    }),
                    Some(30000),
                )
                .await?;
                return capability_snapshot(app, profile.clone(), &cached_catalog);
            }
        }
    }
    let catalog = verified_capability_catalog(app).await?;
    let manifest = catalog
        .packs
        .iter()
        .find(|pack| pack.id == pack_id)
        .ok_or_else(|| format!("Capability pack {pack_id} is not in the verified catalog."))?;
    if !pack_is_compatible(manifest) {
        return Err(format!(
            "Capability pack {} is incompatible with this HELIX Lite version.",
            manifest.capability
        ));
    }
    let destination = installed_pack_path(app, manifest)?;
    if installed_pack_matches(&destination, manifest) {
        request_agent_inner(
            bridge,
            "LOAD_CAPABILITY_PACK",
            json!({
                "id": manifest.id,
                "version": manifest.version,
                "sha256": manifest.sha256
            }),
            Some(30000),
        )
        .await?;
        return capability_snapshot(app, profile.clone(), &catalog);
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Could not initialize capability download: {error}"))?
        .get(&manifest.url)
        .send()
        .await
        .map_err(|error| format!("Could not download capability pack: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Capability pack download returned HTTP {}.",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size as usize > MAX_CAPABILITY_PACK_BYTES)
    {
        return Err("Capability pack exceeds the maximum allowed size.".to_string());
    }
    let expected_size = manifest.size_bytes;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::with_capacity(expected_size);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Could not read capability pack: {error}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_CAPABILITY_PACK_BYTES
            || bytes.len().saturating_add(chunk.len()) > expected_size
        {
            return Err("Capability pack exceeded its signed size limit.".to_string());
        }
        bytes.extend_from_slice(&chunk);
        let _ = app.emit(
            "helix:capability-download-progress",
            json!({
                "id": pack_id,
                "receivedBytes": bytes.len(),
                "totalBytes": expected_size
            }),
        );
    }
    if bytes.len() != manifest.size_bytes || bytes.len() > MAX_CAPABILITY_PACK_BYTES {
        return Err("Capability pack size does not match its signed manifest.".to_string());
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if !hash.eq_ignore_ascii_case(&manifest.sha256) {
        return Err("Capability pack SHA-256 verification failed.".to_string());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Capability pack destination is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create capability pack directory: {error}"))?;
    let staging = parent.join(format!("{}.py.download", manifest.version));
    fs::write(&staging, &bytes)
        .map_err(|error| format!("Could not stage capability pack: {error}"))?;
    let backup = parent.join(format!("{}.py.backup", manifest.version));
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("Could not clear stale capability backup: {error}"))?;
    }
    let had_previous = destination.exists();
    if had_previous {
        fs::rename(&destination, &backup)
            .map_err(|error| format!("Could not preserve the previous capability pack: {error}"))?;
    }
    if let Err(error) = fs::rename(&staging, &destination) {
        if had_previous {
            fs::rename(&backup, &destination).map_err(|restore| {
                format!("Could not activate or restore capability pack: {error}; restore failed: {restore}")
            })?;
        }
        fs::remove_file(&staging).map_err(|cleanup| {
            format!(
                "Could not activate capability pack: {error}; staging cleanup failed: {cleanup}"
            )
        })?;
        return Err(format!(
            "Could not activate verified capability pack: {error}"
        ));
    }
    if had_previous {
        fs::remove_file(&backup).map_err(|error| {
            format!(
                "Capability pack installed, but its previous backup could not be removed: {error}"
            )
        })?;
    }
    request_agent_inner(
        bridge,
        "LOAD_CAPABILITY_PACK",
        json!({
            "id": manifest.id,
            "version": manifest.version,
            "sha256": manifest.sha256
        }),
        Some(30000),
    )
    .await?;
    capability_snapshot(app, profile, &catalog)
}

#[tauri::command]
async fn cancel_capability(
    downloads: State<'_, CapabilityDownloads>,
    pack_id: String,
) -> Result<bool, String> {
    Ok(cancel_capability_operation(downloads.inner(), &pack_id).await)
}

#[tauri::command]
async fn admin_request(
    method: String,
    path: String,
    access_token: String,
) -> Result<Value, String> {
    if access_token.trim().is_empty() {
        return Err("An Admin access token is required".to_string());
    }
    if method != "GET" || path != "/authorization" {
        return Err(
            "Lite release policy is not provisioned; this build will not change Electron policy."
                .to_string(),
        );
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("Could not initialize the Admin API client: {error}"))?;
    let response = client
        .get(format!("{ADMIN_API}/authorization"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("Could not reach HELIX Admin: {error}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(json!({ "success": true, "authenticated": false }));
    }
    if !status.is_success() {
        return Err(format!("HELIX Admin rejected the request (HTTP {status})"));
    }
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read HELIX Admin response: {error}"))?;
    serde_json::from_str::<Value>(&text)
        .map_err(|_| format!("HELIX Admin returned invalid JSON (HTTP {status})"))
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<Value, String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let release = match latest_lite_release().await {
        Ok(release) => release,
        Err(error) => {
            let _ = app.emit(
                "helix:updater-status",
                json!({ "status": "error", "message": error }),
            );
            return Err(error);
        }
    };
    let status = if is_newer_version(&release.version, current_version) {
        "available"
    } else {
        "current"
    };
    let result = json!({
        "status": status,
        "currentVersion": current_version,
        "version": release.version,
        "unsigned": true
    });
    let _ = app.emit("helix:updater-status", result.clone());
    Ok(result)
}

#[tauri::command]
async fn download_update(app: AppHandle, updater: State<'_, UpdaterState>) -> Result<(), String> {
    let release = latest_lite_release().await?;
    let client = reqwest::Client::new();
    let _ = app.emit(
        "helix:updater-status",
        json!({ "status": "downloading", "percent": 0, "transferred": 0, "total": 0 }),
    );
    let installer_bytes = client
        .get(&release.installer_url)
        .send()
        .await
        .map_err(|error| format!("Could not download HELIX Lite update: {error}"))?
        .error_for_status()
        .map_err(|error| format!("HELIX Lite download failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Could not read HELIX Lite update: {error}"))?;
    let expected_checksum = client
        .get(&release.checksum_url)
        .send()
        .await
        .map_err(|error| format!("Could not download update checksum: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Update checksum download failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Could not read update checksum: {error}"))?;
    let expected_checksum = expected_checksum
        .split_whitespace()
        .next()
        .ok_or_else(|| "The update checksum file is empty".to_string())?
        .to_ascii_lowercase();
    let actual_checksum = format!("{:x}", Sha256::digest(&installer_bytes));
    if expected_checksum.len() != 64
        || !expected_checksum
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || actual_checksum != expected_checksum
    {
        return Err("HELIX Lite update failed SHA-256 verification".to_string());
    }
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve update cache directory: {error}"))?;
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Could not create update cache: {error}"))?;
    let installer_path = cache_dir.join(format!("HELIX-Lite-{}-Setup.exe", release.version));
    fs::write(&installer_path, &installer_bytes)
        .map_err(|error| format!("Could not save HELIX Lite update: {error}"))?;
    *updater.0.lock().await = Some(installer_path);
    let _ = app.emit(
        "helix:updater-status",
        json!({
            "status": "downloaded",
            "currentVersion": env!("CARGO_PKG_VERSION"),
            "version": release.version
        }),
    );
    Ok(())
}

#[tauri::command]
async fn install_update(app: AppHandle, updater: State<'_, UpdaterState>) -> Result<(), String> {
    let installer_path = updater.0.lock().await.clone().ok_or_else(|| {
        "Download and verify a HELIX Lite update before installing it".to_string()
    })?;
    let install_dir = std::env::current_exe()
        .map_err(|error| format!("Could not resolve HELIX Lite install directory: {error}"))?
        .parent()
        .ok_or_else(|| "Could not resolve HELIX Lite install directory".to_string())?
        .to_path_buf();
    let mut command = std::process::Command::new(installer_path);
    command
        .arg("/S")
        .arg(format!("/D={}", install_dir.display()));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|error| format!("Could not start the HELIX Lite installer: {error}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn open_toolbox(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("toolbox") {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|error| format!("Could not show HELIX Lite Toolkit: {error}"))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "toolbox",
        WebviewUrl::App("index.html#toolbox".into()),
    )
    .title("HELIX Lite Toolkit")
    .inner_size(1100.0, 760.0)
    .resizable(true)
    .build()
    .map(|_| ())
    .map_err(|error| format!("Could not open HELIX Lite Toolkit: {error}"))
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

async fn send_agent_message(
    bridge: &AgentBridge,
    message_type: &str,
    payload: Value,
    request_id: Option<String>,
) -> Result<(), String> {
    let outgoing = bridge
        .0
        .lock()
        .await
        .outgoing
        .clone()
        .ok_or_else(|| "Python agent is not connected".to_string())?;
    let mut message = json!({
        "type": message_type,
        "payload": payload,
    });
    if let Some(request_id) = request_id {
        message["request_id"] = Value::String(request_id);
    }
    outgoing
        .try_send(message.to_string())
        .map_err(|error| format!("Could not queue agent message: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bridge = AgentBridge::default();
    let updater = UpdaterState::default();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(bridge.clone())
        .manage(CapabilityDownloads::default())
        .manage(updater)
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show HELIX Lite", true, None::<&str>)?;
            let tasks = MenuItem::with_id(app, "tasks", "Show tasks", true, None::<&str>)?;
            let toolbox = MenuItem::with_id(app, "toolbox", "Open Toolkit", true, None::<&str>)?;
            let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit HELIX Lite", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &tasks, &toolbox, &separator, &quit])?;
            let mut tray = TrayIconBuilder::with_id("helix-lite")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "toolbox" => {
                        let _ = open_toolbox(app.clone());
                    }
                    "tasks" => {
                        let _ = app.emit("helix:show-tasks", ());
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            if let Some(main_window) = app.get_webview_window("main") {
                let window_to_hide = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_to_hide.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            start_agent,
            stop_agent,
            agent_send,
            agent_request,
            get_capabilities,
            set_installation_profile,
            install_capability,
            cancel_capability,
            admin_request,
            check_for_updates,
            download_update,
            install_update,
            open_toolbox,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("error while running HELIX Lite Tauri application");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let bridge = app_handle.state::<AgentBridge>().inner().clone();
            tauri::async_runtime::block_on(stop_agent_inner(&bridge));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_pack_ids_and_versions_are_path_safe() {
        assert!(is_safe_pack_id("system-diagnostics"));
        assert!(is_safe_pack_id("2fa"));
        assert!(!is_safe_pack_id("../outside"));
        assert!(!is_safe_pack_id(""));
        assert!(valid_pack_version("1.0.0"));
        assert!(!valid_pack_version("1.0"));
        assert_eq!(parse_semver("v0.1.11"), Some([0, 1, 11]));
        assert!(parse_semver("latest").is_none());
    }

    #[test]
    fn offline_capability_reuse_requires_the_signed_sha256() {
        let root = std::env::temp_dir().join(format!(
            "helix-capability-cache-test-{}",
            create_token().unwrap()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("1.0.0.py");
        let bytes = b"verified capability plugin";
        fs::write(&path, bytes).unwrap();
        let manifest = CapabilityPackManifest {
            id: "system-diagnostics".to_string(),
            version: "1.0.0".to_string(),
            capability: "system-diagnostics".to_string(),
            format: "python-plugin".to_string(),
            required_for_complete: false,
            platform: "win32".to_string(),
            arch: "x64".to_string(),
            core_version_range: "*".to_string(),
            size_bytes: bytes.len(),
            url: format!("{CAPABILITY_ASSET_BASE}system-diagnostics-1.0.0.py"),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            signature: "test-signature".to_string(),
        };

        assert!(installed_pack_matches(&path, &manifest));
        fs::write(&path, b"modified capability plugin").unwrap();
        assert!(!installed_pack_matches(&path, &manifest));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn canonical_signed_json_uses_stable_lexical_key_order() {
        let value = json!({ "zeta": 1, "alpha": { "last": true, "first": false } });
        assert_eq!(
            canonical_json(&value).unwrap(),
            r#"{"alpha":{"first":false,"last":true},"zeta":1}"#
        );
    }

    #[test]
    fn websocket_handshake_uses_bearer_auth_without_changing_url() {
        let request = authenticated_request("ws://127.0.0.1:8765", "opaque-token").unwrap();
        assert_eq!(request.uri().to_string(), "ws://127.0.0.1:8765/");
        assert_eq!(
            request.headers().get(AUTHORIZATION).unwrap(),
            "Bearer opaque-token"
        );
    }

    #[test]
    fn tokens_are_256_bit_hex_values_and_unique() {
        let first = create_token().unwrap();
        let second = create_token().unwrap();
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn event_names_match_the_shared_renderer_contract() {
        assert_eq!(event_channel("agent_message"), "helix:agent-message");
        assert_eq!(event_channel("task_update"), "helix:task-update");
        assert_eq!(event_channel("status_update"), "helix:status-update");
        assert_eq!(
            event_channel("voice_capture_started"),
            "helix:voice_capture_started"
        );
        assert_eq!(event_channel("settings_applied"), "helix:settings-applied");
    }

    #[test]
    fn only_core_chat_events_and_queries_are_exposed_to_the_renderer() {
        assert!(is_supported_event("USER_TEXT"));
        assert!(is_supported_event("TASK_CANCEL"));
        assert!(is_supported_event("CAPABILITY_RESOLVED"));
        assert!(is_supported_request("GET_PROVIDERS"));
        assert!(is_supported_request("GET_MODELS"));
        assert!(is_supported_request("GET_SETTINGS"));
        assert!(is_supported_request("GET_SKILLS"));
        assert!(is_supported_request("GET_MCP_SERVERS"));
        assert!(!is_supported_event("SAVE_SETTINGS"));
        assert!(is_supported_request("VALIDATE_KEY"));
        assert!(is_supported_request("SAVE_SETTINGS"));
        assert!(is_supported_request("TEST_TTS"));
        assert!(is_supported_request("GET_MEMORY_STATUS"));
        assert!(is_supported_request("CLEAR_MEMORY"));
        assert!(is_supported_request("SAVE_SKILL"));
        assert!(is_supported_request("DELETE_SKILL"));
        assert!(!is_supported_request("RUN_ARBITRARY_COMMAND"));
    }

    #[test]
    fn lite_main_window_uses_compact_floating_defaults() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &config["app"]["windows"][0];

        assert_eq!(window["width"], 420);
        assert_eq!(window["height"], 640);
        assert_eq!(window["center"], true);
        assert_eq!(window["resizable"], false);
        assert_eq!(window["alwaysOnTop"], true);
        assert_eq!(window["skipTaskbar"], true);
    }

    #[test]
    fn updater_only_accepts_the_admin_selected_lite_release_and_trusted_assets() {
        assert!(is_valid_release_version("0.1.11"));
        assert!(!is_valid_release_version("v0.1.11"));
        assert!(!is_valid_release_version("0.1"));
        assert!(!is_valid_release_version("0.1.x"));
        assert!(is_trusted_release_asset(
            "https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/lite-v0.1.11/HELIX-Lite-Setup.exe",
            "0.1.11",
            LITE_INSTALLER_ASSET
        ));
        assert!(!is_trusted_release_asset(
            "https://github.com/someone-else/Helix-Assitant/releases/download/lite-v0.1.11/HELIX-Lite-Setup.exe",
            "0.1.11",
            LITE_INSTALLER_ASSET
        ));
        assert!(!is_trusted_release_asset(
            "https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/lite-v0.1.10/HELIX-Lite-Setup.exe",
            "0.1.11",
            LITE_INSTALLER_ASSET
        ));
        assert!(!is_trusted_release_asset(
            "http://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/lite-v0.1.11/HELIX-Lite-Setup.exe",
            "0.1.11",
            LITE_INSTALLER_ASSET
        ));
        assert!(is_newer_version("0.1.11", "0.1.10"));
        assert!(!is_newer_version("0.1.9", "0.1.10"));
        assert!(!is_newer_version("0.1.10", "0.1.10"));
    }

    #[test]
    fn development_agent_is_resolved_from_the_existing_workspace() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let agent = resolve_agent_dir(&manifest, None, None).unwrap();
        assert!(agent.join("main.py").is_file());
    }

    #[test]
    fn bundled_agent_runtime_directory_is_resolved_when_source_is_not_available() {
        let manifest = PathBuf::from("unavailable-manifest");
        let resources = PathBuf::from("resources");
        let bundled_agent = resources.join("agent-runtime/helix-agent.exe");
        let resolved = resolve_agent_dir(&manifest, None, Some(&bundled_agent)).unwrap();
        assert_eq!(resolved, resources.join("agent-runtime"));
    }

    #[test]
    fn python_candidates_prefer_the_workspace_virtual_environment() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let candidates = python_candidates(&root.join("services/agent"), &root);
        assert_eq!(
            candidates.first(),
            Some(&root.join(".venv/Scripts/python.exe"))
        );
    }

    #[tokio::test]
    async fn concurrent_capability_requests_share_one_install_operation() {
        let downloads = CapabilityDownloads::default();
        let executions = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let first_executions = executions.clone();
        let second_executions = executions.clone();

        let (first, second) = tokio::join!(
            coalesce_capability_operation(&downloads, "vision".to_string(), move || async move {
                first_executions.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok(json!({ "status": "installed" }))
            }),
            coalesce_capability_operation(&downloads, "vision".to_string(), move || async move {
                second_executions.fetch_add(1, Ordering::SeqCst);
                Ok(json!({ "status": "installed" }))
            }),
        );

        assert_eq!(first.unwrap(), second.unwrap());
        assert_eq!(executions.load(Ordering::SeqCst), 1);
        assert!(downloads.0.lock().await.is_empty());
    }

    #[tokio::test]
    async fn canceling_a_capability_operation_resolves_all_waiters() {
        let downloads = CapabilityDownloads::default();
        let operation_downloads = downloads.clone();
        let waiter = tokio::spawn(async move {
            coalesce_capability_operation(
                &operation_downloads,
                "vision".to_string(),
                || async move {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    Ok(json!({ "status": "installed" }))
                },
            )
            .await
        });

        for _ in 0..100 {
            if !downloads.0.lock().await.is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        assert!(cancel_capability_operation(&downloads, "vision").await);
        assert_eq!(
            waiter.await.unwrap().unwrap_err(),
            "Capability installation was canceled."
        );
        assert!(!cancel_capability_operation(&downloads, "vision").await);
    }
}
