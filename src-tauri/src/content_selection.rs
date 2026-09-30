use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSelection {
    pub version: u32,
    pub platform: String,
    pub base_ready: bool,
    pub eligible_dlc_ids: Vec<String>,
    pub skipped_dlc_ids: Vec<String>,
    pub missing_base_depot_ids: Vec<String>,
    pub selected_depot_ids: Vec<String>,
    pub dlc_depot_ids: BTreeMap<String, Vec<String>>,
}

impl ContentSelection {
    pub fn dlcs(&self) -> Vec<u32> {
        self.eligible_dlc_ids
            .iter()
            .filter_map(|id| id.parse::<u32>().ok())
            .filter(|id| *id > 0)
            .collect()
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 || self.platform != "windows" {
            return Err("分包筛选协议不匹配，请更新客户端与服务端".into());
        }
        let valid_id = |id: &String| id.parse::<u32>().map(|n| n > 0).unwrap_or(false);
        if self
            .eligible_dlc_ids
            .iter()
            .chain(self.skipped_dlc_ids.iter())
            .chain(self.selected_depot_ids.iter())
            .chain(self.missing_base_depot_ids.iter())
            .any(|id| !valid_id(id))
        {
            return Err("分包筛选结果含无效编号".into());
        }
        let skipped: BTreeSet<_> = self.skipped_dlc_ids.iter().collect();
        if self.eligible_dlc_ids.iter().any(|id| skipped.contains(id)) {
            return Err("分包筛选结果冲突".into());
        }
        let selected: BTreeSet<_> = self.selected_depot_ids.iter().collect();
        if selected.iter().any(|id| skipped.contains(id)) {
            return Err("被排除的 DLC 不应通过分包路径重新启用".into());
        }
        for id in &self.eligible_dlc_ids {
            let depots = self
                .dlc_depot_ids
                .get(id)
                .ok_or("DLC 缺少分包归属，未写入规则")?;
            if depots.iter().any(|d| !valid_id(d) || !selected.contains(d)) {
                return Err("DLC 分包不属于可用集合".into());
            }
        }
        Ok(())
    }

    pub fn require_base(&self) -> Result<(), String> {
        self.validate()?;
        if !self.base_ready
            || self.selected_depot_ids.is_empty()
            || !self.missing_base_depot_ids.is_empty()
        {
            return Err(format!(
                "本体分包数据不完整，未改写现有规则；缺少密钥的分包：{}",
                if self.missing_base_depot_ids.is_empty() {
                    "归属或密钥尚未确认".to_string()
                } else {
                    self.missing_base_depot_ids.join(", ")
                }
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_the_same_contract_as_the_backend_integration_fixture() {
        let plan: ContentSelection = serde_json::from_str(include_str!(
            "../../tests/content-selection/windows-partial.json"
        ))
        .unwrap();
        plan.require_base().unwrap();
        assert_eq!(plan.dlcs(), vec![990300, 990400]);
        assert!(!plan.selected_depot_ids.contains(&"990200".to_string()));
        assert!(!plan.selected_depot_ids.contains(&"990201".to_string()));
    }
    #[test]
    fn rejects_conflicting_and_incomplete_plans() {
        let mut p = ContentSelection {
            version: 1,
            platform: "windows".into(),
            base_ready: true,
            eligible_dlc_ids: vec!["20".into()],
            skipped_dlc_ids: vec![],
            missing_base_depot_ids: vec![],
            selected_depot_ids: vec!["11".into(), "21".into()],
            dlc_depot_ids: [("20".into(), vec!["21".into()])].into(),
        };
        assert!(p.require_base().is_ok());
        p.skipped_dlc_ids.push("20".into());
        assert!(p.validate().is_err());
        p.skipped_dlc_ids.clear();
        p.missing_base_depot_ids.push("11".into());
        assert!(p.require_base().is_err());
        p.missing_base_depot_ids.clear();
        p.dlc_depot_ids.clear();
        assert!(p.validate().is_err());
    }
}
