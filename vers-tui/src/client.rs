//! HTTP client for connecting to vers-agent server
//!
//! Implements the ACP (Agent Client Protocol) over HTTP with SSE for streaming.

use anyhow::{anyhow, Result};
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::vm::{VmInfo, VmListResponse};

/// JSON-RPC request
#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    params: Value,
}

/// JSON-RPC response
#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[serde(rename = "jsonrpc")]
    _jsonrpc: String,
    #[serde(rename = "id")]
    _id: Option<u64>,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

/// Claim response from server
#[derive(Debug, Deserialize)]
pub struct ClaimResponse {
    #[serde(rename = "claimed")]
    pub _claimed: Option<bool>,
    #[serde(rename = "isOwner")]
    pub is_owner: Option<bool>,
    pub error: Option<String>,
    #[serde(rename = "message")]
    pub _message: Option<String>,
}

/// Agent info from initialize
#[derive(Debug, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    #[serde(rename = "version")]
    pub _version: String,
}

/// Session info
#[derive(Debug, Clone, Deserialize)]
pub struct SessionInfo {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(default = "default_mode")]
    pub mode: String,
}

/// VM creation result
#[derive(Debug, Clone, Deserialize)]
pub struct VmCreateResult {
    #[serde(rename = "vmId")]
    pub vm_id: String,
    #[serde(rename = "agentUrl")]
    pub agent_url: String,
}

/// VM branch result
#[derive(Debug, Clone, Deserialize)]
pub struct VmBranchResult {
    #[serde(rename = "vmId")]
    pub vm_id: String,
    #[serde(rename = "parentId")]
    pub parent_id: String,
    #[serde(rename = "agentUrl")]
    pub agent_url: String,
}

fn default_mode() -> String {
    "default".to_string()
}

/// SSE event from server
#[derive(Debug, Clone)]
pub enum ServerEvent {
    Connected,
    ContentChunk { text: String, is_final: bool },
    #[expect(dead_code, reason = "Protocol variant, will be used for tool UI")]
    ToolUse { name: String, status: String },
    Completed {
        #[expect(dead_code, reason = "Protocol field, will be used for timing display")]
        duration_ms: u64,
    },
    Error { message: String },
    ModeUpdate { mode: String },
}

/// Client for vers-agent server
pub struct VersClient {
    client: Client,
    base_url: String,
    request_id: u64,
    pub session_id: Option<String>,
    pub agent_name: Option<String>,
}

impl VersClient {
    pub fn new(base_url: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
            request_id: 0,
            session_id: None,
            agent_name: None,
        }
    }

    fn next_id(&mut self) -> u64 {
        self.request_id += 1;
        self.request_id
    }

    /// Make a JSON-RPC call
    async fn rpc(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id();
        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: method.to_string(),
            params,
        };

        let response = self
            .client
            .post(format!("{}/rpc", self.base_url))
            .json(&request)
            .send()
            .await?;

        let rpc_response: JsonRpcResponse = response.json().await?;

        if let Some(error) = rpc_response.error {
            return Err(anyhow!("RPC error {}: {}", error.code, error.message));
        }

        rpc_response
            .result
            .ok_or_else(|| anyhow!("No result in response"))
    }

    /// Claim the server (for localhost, this should auto-succeed)
    pub async fn claim(&self) -> Result<ClaimResponse> {
        let response = self
            .client
            .post(format!("{}/claim", self.base_url))
            .send()
            .await?;

        let claim: ClaimResponse = response.json().await?;
        Ok(claim)
    }

    /// Initialize connection to server
    pub async fn initialize(&mut self) -> Result<AgentInfo> {
        let result = self
            .rpc(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "vers-tui",
                        "version": "0.1.0"
                    }
                }),
            )
            .await?;

        let agent_info: AgentInfo = serde_json::from_value(result["agentInfo"].clone())?;
        self.agent_name = Some(agent_info.name.clone());
        Ok(agent_info)
    }

    /// Create a new session
    pub async fn new_session(&mut self, model: Option<&str>) -> Result<SessionInfo> {
        let params = match model {
            Some(m) => json!({ "config": { "model": m } }),
            None => json!({ "config": {} }),
        };

        let result = self.rpc("session/new", params).await?;
        let session: SessionInfo = serde_json::from_value(result)?;
        self.session_id = Some(session.session_id.clone());
        Ok(session)
    }

    /// Try to load the most recent session, returns None if no sessions exist
    pub async fn load_recent_session(&mut self) -> Result<Option<SessionInfo>> {
        // List existing sessions
        let list_result = self.rpc("session/list", json!({})).await?;

        // Get the sessions array
        let sessions = list_result
            .get("sessions")
            .and_then(|s| s.as_array())
            .cloned()
            .unwrap_or_default();

        if sessions.is_empty() {
            return Ok(None);
        }

        // Get the most recent session ID (first in list)
        let session_id = sessions
            .first()
            .and_then(|s| s.get("id"))
            .and_then(|id| id.as_str());

        let Some(session_id) = session_id else {
            return Ok(None);
        };

        // Load the session
        let result = self
            .rpc("session/load", json!({ "sessionId": session_id }))
            .await?;

        let session: SessionInfo = serde_json::from_value(result)?;
        self.session_id = Some(session.session_id.clone());
        Ok(Some(session))
    }

    /// Send a prompt
    pub async fn prompt(&mut self, text: &str) -> Result<()> {
        self.rpc("session/prompt", json!({ "text": text })).await?;
        Ok(())
    }

    /// Cancel current operation
    pub async fn cancel(&mut self) -> Result<()> {
        self.rpc("session/cancel", json!({})).await?;
        Ok(())
    }

    // ==================== VM Methods ====================

    /// List all VMs
    pub async fn vm_list(&mut self) -> Result<Vec<VmInfo>> {
        let result = self.rpc("vm/list", json!({})).await?;
        let response: VmListResponse = serde_json::from_value(result)?;
        Ok(response.vms)
    }

    /// Get VM status
    #[expect(dead_code, reason = "API method available for future use")]
    pub async fn vm_status(&mut self, vm_id: &str) -> Result<VmInfo> {
        let result = self.rpc("vm/status", json!({ "vmId": vm_id })).await?;
        let vm: VmInfo = serde_json::from_value(result)?;
        Ok(vm)
    }

    /// Ping a VM to check if it's actually accessible (direct HTTP check, bypasses metadata)
    pub async fn vm_ping(&self, vm_id: &str) -> Result<bool> {
        let url = format!("https://{}.vm.vers.sh/health", vm_id);
        let response = self
            .client
            .get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;

        match response {
            Ok(r) => Ok(r.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    /// Create a new VM
    pub async fn vm_create(&mut self, task: Option<&str>) -> Result<VmCreateResult> {
        let params = match task {
            Some(t) => json!({ "task": t }),
            None => json!({}),
        };
        let result = self.rpc("vm/create", params).await?;
        let vm: VmCreateResult = serde_json::from_value(result)?;
        Ok(vm)
    }

    /// Branch from an existing VM
    pub async fn vm_branch(&mut self, vm_id: &str, approach: Option<&str>) -> Result<VmBranchResult> {
        let mut params = json!({ "vmId": vm_id });
        if let Some(a) = approach {
            params["approach"] = json!(a);
        }
        let result = self.rpc("vm/branch", params).await?;
        let vm: VmBranchResult = serde_json::from_value(result)?;
        Ok(vm)
    }

    /// Delete a VM
    pub async fn vm_delete(&mut self, vm_id: &str) -> Result<()> {
        self.rpc("vm/delete", json!({ "vmId": vm_id })).await?;
        Ok(())
    }

    /// Connect to a VM (sets it as active)
    pub async fn vm_connect(&mut self, vm_id: &str) -> Result<SessionInfo> {
        let result = self.rpc("vm/connect", json!({ "vmId": vm_id })).await?;
        let session: SessionInfo = serde_json::from_value(result)?;
        self.session_id = Some(session.session_id.clone());
        Ok(session)
    }

    // ==================== SSE Events ====================

    /// Subscribe to SSE events
    pub async fn subscribe_events(&self, tx: mpsc::UnboundedSender<ServerEvent>) -> Result<()> {
        let url = format!("{}/events", self.base_url);
        let session_id = self.session_id.clone();

        tokio::spawn(async move {
            let client = Client::new();
            let response = match client.get(&url).send().await {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(ServerEvent::Error {
                        message: format!("Connection failed: {}", e),
                    });
                    return;
                }
            };

            let _ = tx.send(ServerEvent::Connected);

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));

                        // Process complete SSE messages
                        while let Some(pos) = buffer.find("\n\n") {
                            let message = buffer[..pos].to_string();
                            buffer = buffer[pos + 2..].to_string();

                            if let Some(event) = parse_sse_message(&message, &session_id) {
                                if tx.send(event).is_err() {
                                    return;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(ServerEvent::Error {
                            message: format!("Stream error: {}", e),
                        });
                        break;
                    }
                }
            }
        });

        Ok(())
    }
}

/// Parse an SSE message into a ServerEvent
fn parse_sse_message(message: &str, session_id: &Option<String>) -> Option<ServerEvent> {
    let mut event_type = None;
    let mut data = None;

    for line in message.lines() {
        if let Some(value) = line.strip_prefix("event: ") {
            event_type = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("data: ") {
            data = Some(value.to_string());
        }
    }

    let data = data?;
    let json: Value = serde_json::from_str(&data).ok()?;

    // Check if this event is for our session
    if let Some(event_session) = json.get("sessionId").and_then(|v| v.as_str()) {
        if let Some(our_session) = session_id {
            if event_session != our_session {
                return None;
            }
        }
    }

    // Parse based on event type or data content
    let event_type = event_type.as_deref().unwrap_or("");

    match event_type {
        "connected" => Some(ServerEvent::Connected),
        _ => {
            // Parse based on data content
            if let Some(type_field) = json.get("type").and_then(|v| v.as_str()) {
                match type_field {
                    "content_chunk" => {
                        let text = json
                            .get("data")
                            .and_then(|d| d.get("text"))
                            .and_then(|t| t.as_str())
                            .unwrap_or("")
                            .to_string();
                        let is_final = json
                            .get("data")
                            .and_then(|d| d.get("final"))
                            .and_then(|f| f.as_bool())
                            .unwrap_or(false);
                        Some(ServerEvent::ContentChunk { text, is_final })
                    }
                    "completed" => {
                        let duration_ms = json
                            .get("data")
                            .and_then(|d| d.get("durationMs"))
                            .and_then(|d| d.as_u64())
                            .unwrap_or(0);
                        Some(ServerEvent::Completed { duration_ms })
                    }
                    "mode_update" => {
                        let mode = json
                            .get("data")
                            .and_then(|d| d.get("mode"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("default")
                            .to_string();
                        Some(ServerEvent::ModeUpdate { mode })
                    }
                    _ => None,
                }
            } else {
                None
            }
        }
    }
}
