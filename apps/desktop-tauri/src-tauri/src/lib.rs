use std::{
    collections::HashMap,
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tokio::{
    process::{Child, Command},
    sync::{mpsc, oneshot, Mutex},
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
const LITE_RELEASES_API: &str =
    "https://api.github.com/repos/joelpizza0818-blip/Helix-Assitant/releases?per_page=100";
const LITE_RELEASE_TAG_PREFIX: &str = "lite-v";
const LITE_INSTALLER_ASSET: &str = "HELIX-Lite-Setup.exe";

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

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    assets: Vec<GithubAsset>,
}

#[derive(serde::Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
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

async fn latest_lite_release() -> Result<(String, Vec<GithubAsset>), String> {
    let response = reqwest::Client::new()
        .get(LITE_RELEASES_API)
        .header("User-Agent", "HELIX-Lite-Updater")
        .send()
        .await
        .map_err(|error| format!("Could not check the HELIX Lite release feed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("HELIX Lite release feed rejected the request: {error}"))?;
    let releases = response
        .json::<Vec<GithubRelease>>()
        .await
        .map_err(|error| format!("Invalid HELIX Lite release feed: {error}"))?;
    releases
        .into_iter()
        .find(|release| {
            release.tag_name.starts_with(LITE_RELEASE_TAG_PREFIX)
                && !release.draft
                && !release.prerelease
        })
        .map(|release| (release.tag_name, release.assets))
        .ok_or_else(|| "No stable HELIX Lite release is published".to_string())
}

fn release_version(tag: &str) -> Result<&str, String> {
    let version = tag
        .strip_prefix(LITE_RELEASE_TAG_PREFIX)
        .ok_or_else(|| "The release feed returned an invalid HELIX Lite tag".to_string())?;
    if version.split('.').count() != 3
        || version
            .split('.')
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("The release feed returned an invalid HELIX Lite version".to_string());
    }
    Ok(version)
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
                    let request_id = payload.get("request_id").and_then(Value::as_str).unwrap_or("");
                    let capability = payload.get("capability").and_then(Value::as_str).unwrap_or("unknown");
                    let response = json!({
                        "type": "CAPABILITY_RESOLVED",
                        "payload": {
                            "request_id": request_id,
                            "capability": capability,
                            "status": "error",
                            "error": "This HELIX Lite build has no verified capability pack catalog; the required capability was not installed."
                        }
                    });
                    if let Some(sender) = bridge.0.lock().await.outgoing.clone() {
                        let _ = sender.try_send(response.to_string());
                    }
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

    if let Err(error) = send_agent_message(
        bridge.inner(),
        &message_type,
        payload,
        Some(request_id.clone()),
    )
    .await
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

#[tauri::command]
fn get_capabilities(app: AppHandle) -> Result<Value, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve HELIX data directory: {error}"))?;
    let profile_path = data_dir.join("installation-profile.json");
    let profile = fs::read_to_string(profile_path)
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
    Ok(json!({
        "profile": profile,
        "packs": [],
        "missingCount": 1,
        "ready": false
    }))
}

#[tauri::command]
fn set_installation_profile(app: AppHandle, profile: String) -> Result<Value, String> {
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
    get_capabilities(app)
}

#[tauri::command]
fn install_capability() -> Result<Value, String> {
    Err("HELIX Lite cannot install capability packs until a signed, hash-verified Lite catalog is published.".to_string())
}

#[tauri::command]
fn cancel_capability() -> bool {
    false
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
    let (tag, assets) = match latest_lite_release().await {
        Ok(release) => release,
        Err(error) => {
            let _ = app.emit(
                "helix:updater-status",
                json!({ "status": "error", "message": error }),
            );
            return Err(error);
        }
    };
    let version = release_version(&tag)?.to_string();
    let status = if is_newer_version(&version, current_version) {
        "available"
    } else {
        "current"
    };
    let installer_available = assets
        .iter()
        .any(|asset| asset.name == LITE_INSTALLER_ASSET);
    let checksum_available = assets
        .iter()
        .any(|asset| asset.name == format!("{LITE_INSTALLER_ASSET}.sha256"));
    let status = if status == "available" && (!installer_available || !checksum_available) {
        "error"
    } else {
        status
    };
    let result = if status == "error" {
        json!({ "status": status, "message": "The HELIX Lite release is missing its installer or SHA-256 checksum." })
    } else {
        json!({ "status": status, "currentVersion": current_version, "version": version, "unsigned": true })
    };
    let _ = app.emit("helix:updater-status", result.clone());
    Ok(result)
}

#[tauri::command]
async fn download_update(app: AppHandle, updater: State<'_, UpdaterState>) -> Result<(), String> {
    let (tag, assets) = latest_lite_release().await?;
    let version = release_version(&tag)?.to_string();
    let installer = assets
        .iter()
        .find(|asset| asset.name == LITE_INSTALLER_ASSET)
        .ok_or_else(|| "This HELIX Lite release has no installer asset".to_string())?;
    let checksum_asset = assets
        .iter()
        .find(|asset| asset.name == format!("{LITE_INSTALLER_ASSET}.sha256"))
        .ok_or_else(|| "This HELIX Lite release has no SHA-256 checksum asset".to_string())?;
    let client = reqwest::Client::new();
    let _ = app.emit(
        "helix:updater-status",
        json!({ "status": "downloading", "percent": 0, "transferred": 0, "total": 0 }),
    );
    let installer_bytes = client
        .get(&installer.browser_download_url)
        .send()
        .await
        .map_err(|error| format!("Could not download HELIX Lite update: {error}"))?
        .error_for_status()
        .map_err(|error| format!("HELIX Lite download failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Could not read HELIX Lite update: {error}"))?;
    let expected_checksum = client
        .get(&checksum_asset.browser_download_url)
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
    let installer_path = cache_dir.join(format!("HELIX-Lite-{version}-Setup.exe"));
    fs::write(&installer_path, &installer_bytes)
        .map_err(|error| format!("Could not save HELIX Lite update: {error}"))?;
    *updater.0.lock().await = Some(installer_path);
    let _ = app.emit(
        "helix:updater-status",
        json!({ "status": "downloaded", "currentVersion": env!("CARGO_PKG_VERSION"), "version": version }),
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
    fn updater_only_uses_a_lite_release_tag_and_version_order() {
        assert_eq!(release_version("lite-v0.1.11").unwrap(), "0.1.11");
        assert!(release_version("v0.1.11").is_err());
        assert!(release_version("lite-vstable").is_err());
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
}
