//! VM types and canvas tree structures
//!
//! Matches the TypeScript canvas module types for compatibility.

use serde::Deserialize;
use std::collections::HashMap;

/// VM status (matches orchestrator VmStatus)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VmStatus {
    Starting,
    Ready,
    Busy,
    Completed,
    Failed,
    Unhealthy,
    Recovering,
}

impl VmStatus {
    /// Get the status icon for terminal display
    pub const fn icon(self) -> &'static str {
        match self {
            Self::Starting => "○",
            Self::Ready => "●",
            Self::Busy => "◐",
            Self::Completed => "✓",
            Self::Failed => "✗",
            Self::Unhealthy => "⚠",
            Self::Recovering => "↻",
        }
    }

    /// Get the ratatui color for this status
    pub const fn color(self) -> ratatui::style::Color {
        use ratatui::style::Color;
        match self {
            Self::Starting | Self::Recovering => Color::Yellow,
            Self::Ready | Self::Completed => Color::Green,
            Self::Busy => Color::Cyan,
            Self::Failed | Self::Unhealthy => Color::Red,
        }
    }
}

/// A node in the VM branch tree
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    // Identity
    pub vm_id: String,
    pub short_id: String,
    #[serde(rename = "baseUrl")]
    _base_url: String,
    pub shell_url: String,
    pub app_url: String,

    // Tree structure
    #[serde(rename = "parentId")]
    _parent_id: Option<String>,
    #[serde(default)]
    pub children: Vec<TreeNode>,
    pub depth: usize,

    // Task info
    pub task: Option<String>,
    pub approach: Option<String>,
    pub status: VmStatus,
    #[serde(rename = "createdAt")]
    _created_at: String,

    // Live metrics
    #[serde(default)]
    pub duration_ms: u64,
    pub last_activity: Option<String>,
    #[serde(rename = "lastEventAt")]
    _last_event_at: Option<String>,

    // Results (when completed)
    #[serde(rename = "filesChanged")]
    _files_changed: Option<u32>,
    #[serde(rename = "testsPassed")]
    _tests_passed: Option<u32>,
    #[serde(rename = "testsFailed")]
    _tests_failed: Option<u32>,
    pub error: Option<String>,
}

impl TreeNode {
    /// Get display label (task or approach or "VM")
    pub fn label(&self) -> &str {
        self.task
            .as_deref()
            .or(self.approach.as_deref())
            .unwrap_or("VM")
    }

    /// Format duration for display
    pub fn format_duration(&self) -> String {
        let seconds = self.duration_ms / 1000;
        let minutes = seconds / 60;
        let hours = minutes / 60;

        if hours > 0 {
            format!("{}h {}m", hours, minutes % 60)
        } else if minutes > 0 {
            format!("{}m {}s", minutes, seconds % 60)
        } else {
            format!("{}s", seconds)
        }
    }
}

/// The full tree state
#[derive(Debug, Clone, Default)]
pub struct TreeState {
    /// Top-level VMs (no parent)
    pub roots: Vec<TreeNode>,
    /// Quick lookup by vmId (used for tree building)
    #[expect(dead_code, reason = "Used internally for tree construction")]
    node_map: HashMap<String, TreeNode>,
    /// Currently selected VM ID
    #[expect(dead_code, reason = "Will be used for selection persistence")]
    selected_id: Option<String>,
    /// Last update timestamp
    #[expect(dead_code, reason = "Will be used for staleness detection")]
    last_update: Option<String>,
    /// Aggregated stats
    pub total_vms: usize,
    pub running_count: usize,
    pub completed_count: usize,
    pub failed_count: usize,
}

impl TreeState {
    /// Build tree state from a flat list of VMs
    pub fn from_vm_list(vms: Vec<VmInfo>) -> Self {
        let mut node_map: HashMap<String, TreeNode> = HashMap::new();
        let mut children_map: HashMap<String, Vec<String>> = HashMap::new();

        // First pass: create all nodes
        for vm in &vms {
            let node = TreeNode {
                vm_id: vm.id.clone(),
                short_id: vm.id.chars().take(6).collect(),
                _base_url: format!("https://{}.vm.vers.sh", vm.id),
                shell_url: format!("https://{}.vm.vers.sh/shell", vm.id),
                app_url: format!("https://{}.vm.vers.sh/", vm.id),
                _parent_id: vm.parent_id.clone(),
                children: Vec::new(),
                depth: 0,
                task: vm.task.clone(),
                approach: vm.approach.clone(),
                status: vm.status,
                _created_at: vm.created_at.clone(),
                duration_ms: vm.duration_ms.unwrap_or(0),
                last_activity: vm.last_activity.clone(),
                _last_event_at: None,
                _files_changed: None,
                _tests_passed: None,
                _tests_failed: None,
                error: vm.error.clone(),
            };
            node_map.insert(vm.id.clone(), node);

            // Track parent-child relationships
            if let Some(ref parent_id) = vm.parent_id {
                children_map
                    .entry(parent_id.clone())
                    .or_default()
                    .push(vm.id.clone());
            }
        }

        // Second pass: build tree structure
        let mut roots = Vec::new();
        for vm in &vms {
            if vm.parent_id.is_none() {
                if let Some(node) = node_map.get(&vm.id) {
                    let mut root = node.clone();
                    Self::attach_children(&mut root, &node_map, &children_map, 0);
                    roots.push(root);
                }
            }
        }

        // Calculate stats
        let total_vms = vms.len();
        let running_count = vms
            .iter()
            .filter(|v| matches!(v.status, VmStatus::Starting | VmStatus::Ready | VmStatus::Busy))
            .count();
        let completed_count = vms
            .iter()
            .filter(|v| v.status == VmStatus::Completed)
            .count();
        let failed_count = vms
            .iter()
            .filter(|v| matches!(v.status, VmStatus::Failed | VmStatus::Unhealthy))
            .count();

        Self {
            roots,
            node_map,
            selected_id: None,
            last_update: Some(chrono::Utc::now().to_rfc3339()),
            total_vms,
            running_count,
            completed_count,
            failed_count,
        }
    }

    fn attach_children(
        node: &mut TreeNode,
        node_map: &HashMap<String, TreeNode>,
        children_map: &HashMap<String, Vec<String>>,
        depth: usize,
    ) {
        node.depth = depth;
        if let Some(child_ids) = children_map.get(&node.vm_id) {
            for child_id in child_ids {
                if let Some(child_node) = node_map.get(child_id) {
                    let mut child = child_node.clone();
                    Self::attach_children(&mut child, node_map, children_map, depth + 1);
                    node.children.push(child);
                }
            }
        }
    }

    /// Get all nodes flattened for navigation
    pub fn flatten(&self) -> Vec<&TreeNode> {
        let mut result = Vec::new();
        for root in &self.roots {
            Self::flatten_node(root, &mut result);
        }
        result
    }

    fn flatten_node<'a>(node: &'a TreeNode, result: &mut Vec<&'a TreeNode>) {
        result.push(node);
        for child in &node.children {
            Self::flatten_node(child, result);
        }
    }
}

/// VM info from the server's vm/list response
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmInfo {
    #[serde(rename = "vmId")]
    pub id: String,
    pub parent_id: Option<String>,
    pub status: VmStatus,
    pub created_at: String,
    pub task: Option<String>,
    pub approach: Option<String>,
    pub duration_ms: Option<u64>,
    pub last_activity: Option<String>,
    pub error: Option<String>,
}

/// Response from vm/list
#[derive(Debug, Clone, Deserialize)]
pub struct VmListResponse {
    pub vms: Vec<VmInfo>,
}
