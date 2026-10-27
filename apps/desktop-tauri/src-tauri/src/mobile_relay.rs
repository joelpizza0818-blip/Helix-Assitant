use std::{collections::HashMap, time::Duration};

use futures_util::{SinkExt, StreamExt};
use keyring::Entry;
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        client::IntoClientRequest,
        http::header::{HeaderValue, AUTHORIZATION},
        Message,
    },
};

use crate::{send_agent_message, AgentBridge};

const KEYRING_SERVICE: &str = "com.helix.desktop-lite";
const KEYRING_USER: &str = "mobile-relay";
const DEVICE_ID_MIN_LENGTH: usize = 20;
const DEVICE_ID_MAX_LENGTH: usize = 64;
const TOKEN_MIN_LENGTH: usize = 40;
const TOKEN_MAX_LENGTH: usize = 128;
const MAX_MOBILE_TEXT_LENGTH: usize = 50_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const PAIRING_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const RECONNECT_DELAY: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayCredentials {
    worker_api_url: String,
    room_id: String,
    desktop_credential: String,
}

#[derive(Clone, Default)]
pub struct MobileRelayState(std::sync::Arc<Mutex<Runtime>>);

#[derive(Default)]
struct Runtime {
    credentials: Option<RelayCredentials>,
    outgoing: Option<mpsc::Sender<String>>,
    socket_task: Option<JoinHandle<()>>,
    pairings: HashMap<String, PendingPairing>,
    mobile_messages: HashMap<String, PendingMobileMessage>,
}

struct PendingPairing {
    device_name: String,
    response: oneshot::Sender<bool>,
}

struct PendingMobileMessage {
    device_id: String,
    device_name: String,
    text: String,
    response: oneshot::Sender<bool>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MobilePairingInvitation {
    version: u8,
    host: String,
    #[serde(rename = "sshPort")]
    ssh_port: u16,
    #[serde(rename = "remoteWsPort")]
    remote_ws_port: u16,
    token: String,
    #[serde(rename = "expiresAt")]
    expires_at_unix: i64,
    #[serde(rename = "relayWssUrl")]
    relay_wss_url: String,
    #[serde(rename = "requiresDeviceApproval")]
    requires_device_approval: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct PairedMobileDevice {
    device_id: String,
    device_name: String,
    created_at: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct PendingMobilePairing {
    request_id: String,
    device_name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PendingMobileText {
    request_id: String,
    device_id: String,
    device_name: String,
    text: String,
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|error| format!("Could not access Windows secure storage: {error}"))
}

fn load_credentials() -> Result<Option<RelayCredentials>, String> {
    match keyring_entry()?.get_password() {
        Ok(raw) => {
            let credentials = serde_json::from_str::<RelayCredentials>(&raw)
                .map_err(|error| format!("Saved mobile relay credentials are invalid: {error}"))?;
            validate_credentials(&credentials)?;
            Ok(Some(credentials))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read Windows secure storage: {error}")),
    }
}

fn save_credentials(credentials: &RelayCredentials) -> Result<(), String> {
    let value = serde_json::to_string(credentials)
        .map_err(|error| format!("Could not encode mobile relay credentials: {error}"))?;
    keyring_entry()?
        .set_password(&value)
        .map_err(|error| format!("Could not save credentials to Windows secure storage: {error}"))
}

fn delete_credentials() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Could not remove credentials from Windows secure storage: {error}"
        )),
    }
}

fn normalize_worker_url(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| "Worker URL is invalid.".to_string())?;
    let local_host = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if (url.scheme() != "https" && !(local_host && url.scheme() == "http"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Worker URL must be an HTTPS origin.".to_string());
    }
    Ok(url.origin().ascii_serialization())
}

fn valid_secret(value: &str) -> bool {
    (TOKEN_MIN_LENGTH..=TOKEN_MAX_LENGTH).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_device_id(value: &str) -> bool {
    (DEVICE_ID_MIN_LENGTH..=DEVICE_ID_MAX_LENGTH).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn validate_credentials(credentials: &RelayCredentials) -> Result<(), String> {
    if normalize_worker_url(&credentials.worker_api_url)? != credentials.worker_api_url
        || !valid_secret(&credentials.room_id)
        || !valid_secret(&credentials.desktop_credential)
    {
        return Err("Saved mobile relay credentials are invalid.".to_string());
    }
    Ok(())
}

fn room_path(credentials: &RelayCredentials, path: &str) -> String {
    format!("/v1/rooms/{}{path}", credentials.room_id)
}

fn socket_url(credentials: &RelayCredentials) -> Result<String, String> {
    let mut url = Url::parse(&credentials.worker_api_url)
        .map_err(|error| format!("Worker URL is invalid: {error}"))?
        .join(&room_path(credentials, "/socket"))
        .map_err(|error| format!("Could not construct relay socket URL: {error}"))?;
    url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" })
        .map_err(|_| "Could not construct secure relay socket URL.".to_string())?;
    Ok(url.to_string())
}

async fn relay_request(
    credentials: &RelayCredentials,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not initialize the HELIX relay client: {error}"))?;
    let url = Url::parse(&credentials.worker_api_url)
        .map_err(|error| format!("Worker URL is invalid: {error}"))?
        .join(&room_path(credentials, path))
        .map_err(|error| format!("Could not construct relay request URL: {error}"))?;
    let mut request = client
        .request(method, url)
        .bearer_auth(&credentials.desktop_credential);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach the HELIX relay: {error}"))?;
    let status = response.status();
    if status.as_u16() == 204 {
        return Ok(Value::Null);
    }
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the HELIX relay response: {error}"))?;
    let payload = serde_json::from_str::<Value>(&response_text);
    if !status.is_success() {
        let detail = payload
            .as_ref()
            .ok()
            .and_then(|payload| payload.get("error"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(detail) = detail {
            return Err(format!("{detail} (HTTP {}).", status.as_u16()));
        }
        return match payload {
            Ok(_) => Err(format!("Relay request failed (HTTP {}).", status.as_u16())),
            Err(error) => Err(format!(
                "Relay request failed (HTTP {}); the response was not valid JSON: {error}",
                status.as_u16()
            )),
        };
    }
    payload.map_err(|error| format!("The HELIX relay returned invalid JSON: {error}"))
}

impl MobileRelayState {
    pub async fn initialize(&self, app: AppHandle, bridge: AgentBridge) -> Result<(), String> {
        let Some(credentials) = load_credentials()? else {
            return Ok(());
        };
        relay_request(&credentials, Method::POST, "/register", None).await?;
        self.start_socket(app, bridge, credentials).await;
        Ok(())
    }

    pub async fn worker_url(&self) -> String {
        self.0
            .lock()
            .await
            .credentials
            .as_ref()
            .map(|credentials| credentials.worker_api_url.clone())
            .unwrap_or_default()
    }

    pub async fn connected(&self) -> bool {
        self.0.lock().await.outgoing.is_some()
    }

    pub async fn set_worker_url(
        &self,
        app: AppHandle,
        bridge: AgentBridge,
        value: String,
    ) -> Result<String, String> {
        if value.trim().is_empty() {
            delete_credentials()?;
            let mut runtime = self.0.lock().await;
            if let Some(task) = runtime.socket_task.take() {
                task.abort();
            }
            runtime.outgoing = None;
            runtime.credentials = None;
            runtime.pairings.clear();
            runtime.mobile_messages.clear();
            let _ = app.emit(
                "helix:mobile-relay-status",
                json!({ "configured": false, "connected": false }),
            );
            return Ok(String::new());
        }

        let worker_api_url = normalize_worker_url(&value)?;
        let existing = self.0.lock().await.credentials.clone();
        if let Some(credentials) = existing {
            if credentials.worker_api_url == worker_api_url {
                if !self.connected().await {
                    self.start_socket(app, bridge, credentials).await;
                }
                return Ok(worker_api_url);
            }
        }

        let credentials = RelayCredentials {
            worker_api_url: worker_api_url.clone(),
            room_id: crate::create_token()?,
            desktop_credential: crate::create_token()?,
        };
        relay_request(&credentials, Method::POST, "/register", None).await?;
        save_credentials(&credentials)?;
        self.start_socket(app, bridge, credentials).await;
        Ok(worker_api_url)
    }

    pub async fn create_invitation(&self) -> Result<MobilePairingInvitation, String> {
        let credentials = self.require_credentials().await?;
        if !self.connected().await {
            return Err("The HELIX mobile relay is not connected.".to_string());
        }
        let token = crate::create_token()?;
        let response = relay_request(
            &credentials,
            Method::POST,
            "/invitations",
            Some(json!({ "token": token })),
        )
        .await?;
        let expires_at_unix = response
            .get("expires_at")
            .and_then(Value::as_i64)
            .ok_or_else(|| "The relay returned an invalid invitation expiry.".to_string())?;
        let relay_wss_url = socket_url(&credentials)?;
        Ok(MobilePairingInvitation {
            version: 2,
            host: relay_wss_url.clone(),
            ssh_port: 22,
            remote_ws_port: 0,
            token,
            expires_at_unix,
            relay_wss_url,
            requires_device_approval: true,
        })
    }

    pub async fn devices(&self) -> Result<Vec<PairedMobileDevice>, String> {
        let credentials = self.require_credentials().await?;
        let response = relay_request(&credentials, Method::GET, "/devices", None).await?;
        let devices = response
            .get("devices")
            .and_then(Value::as_array)
            .ok_or_else(|| "The relay returned an invalid device list.".to_string())?;
        devices
            .iter()
            .map(|value| {
                let device_id = value
                    .get("device_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "The relay returned an invalid device entry.".to_string())?;
                let device_name = value
                    .get("device_name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "The relay returned an invalid device entry.".to_string())?;
                let created_at = value
                    .get("created_at")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| "The relay returned an invalid device entry.".to_string())?;
                if !valid_device_id(device_id) {
                    return Err("The relay returned an invalid device ID.".to_string());
                }
                Ok(PairedMobileDevice {
                    device_id: device_id.to_string(),
                    device_name: device_name.to_string(),
                    created_at,
                })
            })
            .collect()
    }

    pub async fn revoke_device(&self, device_id: String) -> Result<(), String> {
        if !valid_device_id(&device_id) {
            return Err("Device ID is invalid.".to_string());
        }
        let credentials = self.require_credentials().await?;
        relay_request(
            &credentials,
            Method::DELETE,
            &format!("/devices/{device_id}"),
            None,
        )
        .await?;
        Ok(())
    }

    pub async fn pending_pairings(&self) -> Vec<PendingMobilePairing> {
        self.0
            .lock()
            .await
            .pairings
            .iter()
            .map(|(request_id, value)| PendingMobilePairing {
                request_id: request_id.clone(),
                device_name: value.device_name.clone(),
            })
            .collect()
    }

    pub async fn pending_mobile_texts(&self) -> Vec<PendingMobileText> {
        self.0
            .lock()
            .await
            .mobile_messages
            .iter()
            .map(|(request_id, value)| PendingMobileText {
                request_id: request_id.clone(),
                device_id: value.device_id.clone(),
                device_name: value.device_name.clone(),
                text: value.text.clone(),
            })
            .collect()
    }

    pub async fn resolve_pairing(&self, request_id: String, approved: bool) -> Result<(), String> {
        let pending = self.0.lock().await.pairings.remove(&request_id);
        let Some(pending) = pending else {
            return Err("The mobile pairing request expired or was already resolved.".to_string());
        };
        pending
            .response
            .send(approved)
            .map_err(|_| "The mobile pairing request is no longer active.".to_string())
    }

    pub async fn resolve_mobile_text(
        &self,
        request_id: String,
        approved: bool,
    ) -> Result<(), String> {
        let pending = self.0.lock().await.mobile_messages.remove(&request_id);
        let Some(pending) = pending else {
            return Err("The mobile message request expired or was already resolved.".to_string());
        };
        pending
            .response
            .send(approved)
            .map_err(|_| "The mobile message request is no longer active.".to_string())
    }

    pub async fn send_agent_event(&self, message_type: &str, payload: &Value) {
        if !matches!(
            message_type,
            "agent_message" | "status_update" | "task_update" | "error"
        ) {
            return;
        }
        let Some(conversation_id) = payload.get("conversation_id").and_then(Value::as_str) else {
            return;
        };
        let Some(device_id) = conversation_id.strip_prefix("mobile_") else {
            return;
        };
        if !valid_device_id(device_id) {
            return;
        }
        if let Err(error) = self
            .send_device_event(device_id, message_type, payload.clone())
            .await
        {
            eprintln!("[MobileRelay] Could not send event to mobile device: {error}");
        }
    }

    async fn require_credentials(&self) -> Result<RelayCredentials, String> {
        self.0
            .lock()
            .await
            .credentials
            .clone()
            .ok_or_else(|| "The mobile relay Worker URL is not configured.".to_string())
    }

    async fn start_socket(
        &self,
        app: AppHandle,
        bridge: AgentBridge,
        credentials: RelayCredentials,
    ) {
        let mut runtime = self.0.lock().await;
        if let Some(task) = runtime.socket_task.take() {
            task.abort();
        }
        runtime.outgoing = None;
        runtime.credentials = Some(credentials.clone());
        runtime.pairings.clear();
        runtime.mobile_messages.clear();
        let state = self.clone();
        let task = tauri::async_runtime::spawn(async move {
            state.run_socket_loop(app, bridge, credentials).await;
        });
        runtime.socket_task = Some(task);
    }

    async fn run_socket_loop(
        &self,
        app: AppHandle,
        bridge: AgentBridge,
        credentials: RelayCredentials,
    ) {
        loop {
            if self.0.lock().await.credentials.as_ref() != Some(&credentials) {
                break;
            }
            let connected = self.connect_socket(&app, &bridge, &credentials).await;
            self.set_outgoing(&app, &credentials, None).await;
            if let Err(error) = connected {
                eprintln!("[MobileRelay] Connection ended: {error}");
            }
            tokio::time::sleep(RECONNECT_DELAY).await;
        }
    }

    async fn connect_socket(
        &self,
        app: &AppHandle,
        bridge: &AgentBridge,
        credentials: &RelayCredentials,
    ) -> Result<(), String> {
        let mut request = socket_url(credentials)?
            .into_client_request()
            .map_err(|error| format!("Could not create relay socket request: {error}"))?;
        request.headers_mut().insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", credentials.desktop_credential))
                .map_err(|error| format!("Could not create relay authorization header: {error}"))?,
        );
        let (socket, _) = tokio::time::timeout(REQUEST_TIMEOUT, connect_async(request))
            .await
            .map_err(|_| "Timed out connecting to the HELIX relay.".to_string())?
            .map_err(|error| format!("Could not connect to the HELIX relay: {error}"))?;
        let (mut writer, mut reader) = socket.split();
        let (outgoing, mut receiver) = mpsc::channel::<String>(64);
        self.set_outgoing(app, credentials, Some(outgoing)).await;

        loop {
            tokio::select! {
                outbound = receiver.recv() => {
                    let Some(outbound) = outbound else { break };
                    if writer.send(Message::Text(outbound.into())).await.is_err() {
                        break;
                    }
                }
                incoming = reader.next() => {
                    let Some(Ok(frame)) = incoming else { break };
                    match frame {
                        Message::Text(text) => {
                            self.handle_socket_message(
                                app,
                                bridge,
                                credentials,
                                text.as_str(),
                            ).await;
                        }
                        Message::Ping(payload) => {
                            if writer.send(Message::Pong(payload)).await.is_err() {
                                break;
                            }
                        }
                        Message::Pong(_) | Message::Frame(_) => {}
                        Message::Close(_) | Message::Binary(_) => break,
                    }
                }
            }
        }
        Ok(())
    }

    async fn handle_socket_message(
        &self,
        app: &AppHandle,
        bridge: &AgentBridge,
        credentials: &RelayCredentials,
        raw: &str,
    ) {
        let message = match serde_json::from_str::<Value>(raw) {
            Ok(message) => message,
            Err(error) => {
                eprintln!("[MobileRelay] Ignoring invalid relay message: {error}");
                return;
            }
        };
        let Some(message_type) = message.get("type").and_then(Value::as_str) else {
            eprintln!("[MobileRelay] Ignoring relay message without a type.");
            return;
        };
        match message_type {
            "HELIX_PAIRING_REQUEST" => {
                let Some(payload) = message.get("payload") else {
                    eprintln!("[MobileRelay] Ignoring malformed pairing request.");
                    return;
                };
                let Some(request_id) = payload.get("request_id").and_then(Value::as_str) else {
                    eprintln!("[MobileRelay] Ignoring pairing request without an ID.");
                    return;
                };
                let Some(device_name) = payload.get("device_name").and_then(Value::as_str) else {
                    eprintln!("[MobileRelay] Ignoring pairing request without a device name.");
                    return;
                };
                if !valid_device_id(request_id) || device_name.len() > 120 {
                    eprintln!("[MobileRelay] Ignoring invalid pairing request.");
                    return;
                }
                let (response, receiver) = oneshot::channel();
                self.0.lock().await.pairings.insert(
                    request_id.to_string(),
                    PendingPairing {
                        device_name: device_name.to_string(),
                        response,
                    },
                );
                let _ = app.emit(
                    "helix:mobile-pairing-request",
                    PendingMobilePairing {
                        request_id: request_id.to_string(),
                        device_name: device_name.to_string(),
                    },
                );
                let approved = tokio::time::timeout(PAIRING_TIMEOUT, receiver)
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or(false);
                self.0.lock().await.pairings.remove(request_id);
                let action = if approved { "approve" } else { "reject" };
                if let Err(error) = relay_request(
                    credentials,
                    Method::POST,
                    &format!("/pairings/{request_id}/{action}"),
                    None,
                )
                .await
                {
                    eprintln!("[MobileRelay] Could not resolve pairing request: {error}");
                }
            }
            "USER_TEXT" => {
                let Some(device_id) = message.get("source_device_id").and_then(Value::as_str)
                else {
                    eprintln!("[MobileRelay] Ignoring mobile message without a device ID.");
                    return;
                };
                let device_name = message
                    .get("source_device_name")
                    .and_then(Value::as_str)
                    .unwrap_or("HELIX Mobile");
                let Some(text) = message
                    .get("payload")
                    .and_then(|payload| payload.get("text"))
                    .and_then(Value::as_str)
                else {
                    eprintln!("[MobileRelay] Ignoring mobile message without text.");
                    return;
                };
                if !valid_device_id(device_id)
                    || device_name.len() > 120
                    || text.trim().is_empty()
                    || text.chars().count() > MAX_MOBILE_TEXT_LENGTH
                {
                    eprintln!("[MobileRelay] Ignoring invalid mobile text.");
                    return;
                }

                let request_id = match crate::create_token() {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("[MobileRelay] Could not create message approval ID: {error}");
                        return;
                    }
                };
                let (response, receiver) = oneshot::channel();
                self.0.lock().await.mobile_messages.insert(
                    request_id.clone(),
                    PendingMobileMessage {
                        device_id: device_id.to_string(),
                        device_name: device_name.to_string(),
                        text: text.to_string(),
                        response,
                    },
                );
                let _ = app.emit(
                    "helix:mobile-text-request",
                    PendingMobileText {
                        request_id: request_id.clone(),
                        device_id: device_id.to_string(),
                        device_name: device_name.to_string(),
                        text: text.to_string(),
                    },
                );
                let approved = tokio::time::timeout(PAIRING_TIMEOUT, receiver)
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or(false);
                self.0.lock().await.mobile_messages.remove(&request_id);
                if approved {
                    let payload = json!({
                        "text": text,
                        "conversation_id": format!("mobile_{device_id}"),
                        "conversation_history": [],
                    });
                    if let Err(error) = send_agent_message(bridge, "USER_TEXT", payload, None).await
                    {
                        eprintln!("[MobileRelay] Could not forward approved mobile text: {error}");
                        let _ = self
                            .send_device_event(
                                device_id,
                                "error",
                                json!({
                                    "conversation_id": format!("mobile_{device_id}"),
                                    "message": "HELIX Desktop could not process the approved request.",
                                }),
                            )
                            .await;
                    }
                } else {
                    let _ = self
                        .send_device_event(
                            device_id,
                            "error",
                            json!({
                                "conversation_id": format!("mobile_{device_id}"),
                                "message": "The request was denied on the Desktop.",
                            }),
                        )
                        .await;
                }
            }
            _ => {}
        }
    }

    async fn set_outgoing(
        &self,
        app: &AppHandle,
        credentials: &RelayCredentials,
        outgoing: Option<mpsc::Sender<String>>,
    ) {
        let mut runtime = self.0.lock().await;
        if runtime.credentials.as_ref() == Some(credentials) {
            let connected = outgoing.is_some();
            runtime.outgoing = outgoing;
            let configured = runtime.credentials.is_some();
            drop(runtime);
            let _ = app.emit(
                "helix:mobile-relay-status",
                json!({ "configured": configured, "connected": connected }),
            );
        }
    }

    async fn send_device_event(
        &self,
        device_id: &str,
        message_type: &str,
        payload: Value,
    ) -> Result<(), String> {
        if !valid_device_id(device_id)
            || !matches!(
                message_type,
                "agent_message" | "status_update" | "task_update" | "error"
            )
        {
            return Err("Relay device event is invalid.".to_string());
        }
        let outgoing = self
            .0
            .lock()
            .await
            .outgoing
            .clone()
            .ok_or_else(|| "The HELIX mobile relay is disconnected.".to_string())?;
        outgoing
            .send(
                json!({
                    "type": message_type,
                    "target_device_id": device_id,
                    "payload": payload,
                })
                .to_string(),
            )
            .await
            .map_err(|error| format!("Could not queue relay device event: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_url_requires_an_origin_over_tls() {
        assert_eq!(
            normalize_worker_url("https://relay.example/").unwrap(),
            "https://relay.example"
        );
        assert!(normalize_worker_url("http://relay.example").is_err());
        assert!(normalize_worker_url("https://relay.example/path").is_err());
        assert!(normalize_worker_url("https://user@relay.example").is_err());
    }

    #[test]
    fn room_device_and_token_patterns_are_bounded() {
        assert!(valid_secret(&"A".repeat(TOKEN_MIN_LENGTH)));
        assert!(!valid_secret(&"A".repeat(TOKEN_MIN_LENGTH - 1)));
        assert!(valid_device_id(&"d".repeat(DEVICE_ID_MIN_LENGTH)));
        assert!(!valid_device_id(&"d".repeat(DEVICE_ID_MIN_LENGTH - 1)));
        assert!(!valid_device_id(&"x".repeat(DEVICE_ID_MAX_LENGTH + 1)));
    }
}
