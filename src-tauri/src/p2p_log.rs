use serde::{Deserialize, Serialize};
pub const PEER_LATENCY_STALE_MS: i64 = 30_000;

// 日志使用本地墙钟；调用方传入同一墙钟参考时间，不跨时区猜测。
pub fn log_time_ms(value: &str) -> Option<i64> {
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: usize = value.get(5..7)?.parse().ok()?;
    let day: i64 = value.get(8..10)?.parse().ok()?;
    let hour: i64 = value.get(11..13)?.parse().ok()?;
    let minute: i64 = value.get(14..16)?.parse().ok()?;
    let second: i64 = value.get(17..19)?.parse().ok()?;
    if !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    let leap = |y: i64| y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let months = [
        31,
        if leap(year) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if day < 1 || day > months[month - 1] {
        return None;
    }
    let mut days = 0;
    for y in 1970..year {
        days += if leap(y) { 366 } else { 365 };
    }
    days += months[..month - 1].iter().sum::<i64>() + day - 1;
    Some((days * 86400 + hour * 3600 + minute * 60 + second) * 1000)
}
fn numeric_after(line: &str, mark: &str) -> Option<f64> {
    let rest = line.get(line.find(mark)? + mark.len()..)?.trim_start();
    let value: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    value.parse().ok()
}
fn integer_after(line: &str, mark: &str) -> Option<String> {
    let rest = line.get(line.find(mark)? + mark.len()..)?.trim_start();
    let value: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pPeer {
    /// 对端标识：openp2p 里是**人类可读名称**（如 `firefly8-IgjCkPKp`、`柠檬仔ckb的PC`）
    pub node_id: String,
    /// 入站(别人连我) / 出站(我连别人)
    pub direction: String,
    /// 隧道类型：direct（直连打洞） / relay（中继）
    pub transport: String,
    /// 关联端口（openp2p 日志未提供时为空）
    pub ports: Vec<u16>,
    /// 最近一次活跃时间（日志时间戳原文）
    pub last_seen: String,
    /// openp2p 的 appID（int64，日志原文；未识别时为空串）
    pub app_id: String,
    pub latency_ms: Option<f64>,
    pub latency_updated_at: Option<String>,
    pub latency_stale: bool,
    pub latency_source: Option<String>,
}

pub fn parse_p2p_peers_at(text: &str, now_ms: i64) -> Vec<P2pPeer> {
    P2pPeerTracker::default().feed(text, now_ms)
}

use std::collections::HashMap;
#[derive(Default, Clone)]
struct Entry {
    online: bool,
    last_seen: String,
    transport: String,
    app_id: String,
    outbound: bool,
    ports: Vec<u16>,
    latency_ms: Option<f64>,
    latency_updated_at: Option<String>,
    latency_stamp: Option<i64>,
    latency_source: Option<String>,
}

#[derive(Default)]
pub struct P2pPeerTracker {
    map: HashMap<String, Entry>,
    app_names: HashMap<String, String>,
    app_ids: HashMap<String, String>,
    direct_tunnels: HashMap<String, String>,
}
impl P2pPeerTracker {
    pub fn feed(&mut self, text: &str, now_ms: i64) -> Vec<P2pPeer> {
        let map = &mut self.map;
        let app_names = &mut self.app_names;
        let app_ids = &mut self.app_ids;
        let direct_tunnels = &mut self.direct_tunnels;

        // 取行首时间戳（"2026/09/12 11:43:25.707317"）-> "2026/09/12 11:43:25"
        fn line_time(line: &str) -> String {
            let t = line.trim_start();
            if t.len() >= 19
                && t.as_bytes().get(4) == Some(&b'/')
                && t.as_bytes().get(10) == Some(&b' ')
            {
                t.get(..19).unwrap_or("").to_string()
            } else {
                String::new()
            }
        }
        // 名称 token：从 start 起取到空白/冒号/逗号为止（不含空格，符合 openp2p 命名）
        fn token_from(s: &str) -> String {
            s.trim_start()
                .chars()
                .take_while(|c| !c.is_whitespace() && *c != ',' && *c != ':')
                .collect()
        }
        // 过滤掉不像对端名的 token（避免把 ID/端口/路径当成人名）
        fn looks_like_peer_name(t: &str) -> bool {
            !t.is_empty()
                && t.len() >= 2
                && t != "retryApp"
            && (!t.chars().all(|c| c.is_ascii_digit()) || t.len() == 16)
                && !t.contains("error")
                && !t.contains(':')
                && !t.contains('\\')
                && !t.contains('/')
                && !t.starts_with("appid")
        }
        // 从 `... <mark><name>` 形式取名称
        fn after<'a>(line: &'a str, mark: &str) -> Option<String> {
            let pos = line.find(mark)?;
            let t = token_from(&line[pos + mark.len()..]);
            if looks_like_peer_name(&t) {
                Some(t)
            } else {
                None
            }
        }
        // 取 `appid:<数字>` 原文（int64，不能当 u32 截断）
        fn appid_of(line: &str) -> Option<String> {
            if !line.contains("appid:") {
                let pos = line.find("addApp ")?;
                let id = line[pos + 7..].split_whitespace().next()?;
                return if id.chars().all(|c| c.is_ascii_digit()) {
                    Some(id.to_string())
                } else {
                    None
                };
            }
            let pos = line.find("appid:")?;
            let d: String = line[pos + 6..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if d.is_empty() {
                None
            } else {
                Some(d)
            }
        }

        for line in text.lines() {
            if line.contains("P2PNetwork init start") {
                map.clear();
                app_names.clear();
                app_ids.clear();
                direct_tunnels.clear();
            }
            let appid = appid_of(line);
            if line.contains("addApp ") {
                if let Some(peer) = after(line, " to ") {
                    if let Some(pos) = line.find("addApp ") {
                        if let Some(name) = line[pos + 7..].split_whitespace().next() {
                            app_names.insert(name.to_string(), peer.clone());
                        }
                    }
                    if let Some(id) = &appid {
                        app_ids.insert(id.clone(), peer);
                    }
                }
            }
            if line.contains("offline") {
                let peer = after(line, "detect peer ")
                    .or_else(|| after(line, "checkDirectTunnel "))
                    .or_else(|| after(line, "checkRelayTunnel "));
                if let Some(entry) = peer.as_ref().and_then(|peer| map.get_mut(peer)) {
                    entry.online = false;
                    entry.latency_ms = None;
                    entry.latency_stamp = None;
                    entry.latency_updated_at = None;
                    entry.latency_source = None;
                }
                if let Some(peer) = &peer {
                    direct_tunnels.retain(|_, name| name != peer);
                    app_ids.retain(|_, name| name != peer);
                }
            }
            // 失败行一律跳过：绝不能把 "peer offline" 当成一次连接
            if line.contains("error") || line.contains("offline") {
                continue;
            }
            let ts = line_time(line);
            // 只有带 AppID 或已绑定的直连隧道 ID 的心跳行才可作为对端延迟。
            let sample = if let Some(pos) = line.find(" read tunnel heartbeat ack") {
                let tid = line[..pos].split_whitespace().last().unwrap_or("");
                direct_tunnels.get(tid).cloned().and_then(|peer| {
                    numeric_after(line, "rtt=").map(|value| (peer, value, "tunnel-heartbeat"))
                })
            } else if line.contains("relay heartbeat ") && line.contains(" store rtt ") {
                appid
                    .as_ref()
                    .and_then(|id| app_ids.get(id))
                    .cloned()
                    .and_then(|peer| {
                        numeric_after(line, " store rtt ")
                            .map(|value| (peer, value, "relay-heartbeat"))
                    })
            } else {
                None
            };
            if let Some((peer, value, source)) = sample {
                if value.is_finite() && (0.0..=60000.0).contains(&value) {
                    if let Some(stamp) = log_time_ms(&ts) {
                        if let Some(entry) = map.get_mut(&peer) {
                            entry.online = true;
                            entry.last_seen = ts.clone();
                            entry.latency_ms = Some(value);
                            entry.latency_updated_at = Some(ts.clone());
                            entry.latency_stamp = Some(stamp);
                            entry.latency_source = Some(source.to_string());
                            entry.transport = if source == "relay-heartbeat" {
                                "relay"
                            } else {
                                "direct"
                            }
                            .to_string();
                        }
                    }
                }
                continue;
            }
            // 传输方式提示
            let transport = if line.contains("Relay") || line.contains("relay") {
                Some("relay")
            } else if line.contains("Direct") || line.contains("direct") {
                Some("direct")
            } else {
                None
            };

            // 事件 1：addApp <id> to <peer>::0 end  -> 存在指向该对端的隧道（在线）
            if let Some(peer) = after(line, " to ") {
                if line.contains("addApp") {
                    let e = map.entry(peer).or_default();
                    e.online = true;
                    e.last_seen = ts;
                    if let Some(a) = &appid {
                        e.app_id = a.clone();
                    }
                    if let Some(t) = transport {
                        e.transport = t.to_string();
                    }
                    continue;
                }
            }
            // 事件 2：<peer> online, retryApp
            if line.contains(" online,") {
                if let Some(peer) = after(line, "INFO ") {
                    let e = map.entry(peer).or_default();
                    e.online = true;
                    if !ts.is_empty() {
                        e.last_seen = ts;
                    }
                    continue;
                }
            }
            // 事件 3：<id> p2ptunnel close <peer>  -> 断开
            if line.contains("p2ptunnel close") {
                if let Some(peer) = after(line, "p2ptunnel close ") {
                    direct_tunnels.retain(|_, name| name != &peer);
                    app_ids.retain(|_, name| name != &peer);
                    if let Some(e) = map.get_mut(&peer) {
                        e.online = false;
                        e.latency_ms = None;
                        e.latency_stamp = None;
                        e.latency_updated_at = None;
                        e.latency_source = None;
                        if !ts.is_empty() {
                            e.last_seen = ts;
                        }
                    }
                    continue;
                }
            }
            // 事件 4：... detect peer <peer> disconnect  -> 断开
            if line.contains("disconnect") {
                if let Some(peer) = after(line, "detect peer ") {
                    direct_tunnels.retain(|_, name| name != &peer);
                    app_ids.retain(|_, name| name != &peer);
                    if let Some(e) = map.get_mut(&peer) {
                        e.online = false;
                        e.latency_ms = None;
                        e.latency_stamp = None;
                        e.latency_updated_at = None;
                        e.latency_source = None;
                        if !ts.is_empty() {
                            e.last_seen = ts;
                        }
                    }
                    continue;
                }
            }
            // 事件 5：本机主动发起隧道成功（buildDirectTunnel ok / start p2pTunnel to / addRelayTunnel to）
            if line.contains("buildDirectTunnel ok")
                || line.contains("start p2pTunnel to")
                || line.contains("addRelayTunnel to")
            {
                let peer = line
                    .find("buildDirectTunnel ok. ")
                    .and_then(|pos| {
                        let alias = token_from(&line[pos + "buildDirectTunnel ok. ".len()..]);
                        app_names.get(&alias).cloned().or_else(|| {
                            if looks_like_peer_name(&alias) {
                                Some(alias)
                            } else {
                                None
                            }
                        })
                    })
                    .or_else(|| after(line, "start p2pTunnel to"))
                    .or_else(|| after(line, "addRelayTunnel to"));
                if let Some(name) = peer {
                    let peer = app_names.get(&name).cloned().unwrap_or(name);
                    if let Some(id) = &appid {
                        app_ids.insert(id.clone(), peer.clone());
                    }
                    if line.contains("buildDirectTunnel ok") {
                        if let Some(tid) = integer_after(line, " use tid ") {
                            direct_tunnels.insert(tid, peer.clone());
                        }
                    }
                    let e = map.entry(peer).or_default();
                    if let Some(id) = &appid {
                        e.app_id = id.clone();
                    }
                    e.online = true;
                    e.outbound = true;
                    if !ts.is_empty() {
                        e.last_seen = ts;
                    }
                    if let Some(t) = transport {
                        e.transport = t.to_string();
                    }
                }
                continue;
            }
            // 事件 6（房主侧）：`appid:%d tcp accept on port %d start` / udp accept ...
            // 这是**入站接入**事件，但 openp2p 未在其中记录对端身份，只有本地端口。
            // 因此以「本地端口 N 有玩家接入」的形式展示匿名连接 —— 至少让房主知道有人连进来了。
            if (line.contains("tcp accept on port") || line.contains("udp accept on port"))
                && line.contains("start")
            {
                let proto = if line.contains("udp accept on port") {
                    "udp"
                } else {
                    "tcp"
                };
                // 取 "on port " 之后的端口号
                let port: Option<u16> = line
                    .find("on port ")
                    .map(|p| {
                        line[p + 8..]
                            .chars()
                            .take_while(|c| c.is_ascii_digit())
                            .collect::<String>()
                    })
                    .and_then(|d| d.parse().ok());
                if let Some(port) = port {
                    let key = format!("local:{}:{}", proto, port);
                    let e = map.entry(key).or_default();
                    e.online = true;
                    if !ts.is_empty() {
                        e.last_seen = ts;
                    }
                    if e.transport.is_empty() {
                        e.transport = "direct".to_string();
                    }
                    if let Some(a) = &appid {
                        e.app_id = a.clone();
                    }
                    if !e.ports.contains(&port) {
                        e.ports.push(port);
                    }
                }
            }
        }

        if map.len() > 256 {
            let mut order: Vec<_> = map
                .iter()
                .map(|(name, entry)| (name.clone(), entry.last_seen.clone()))
                .collect();
            order.sort_by(|a, b| b.1.cmp(&a.1));
            for (name, _) in order.into_iter().skip(256) {
                map.remove(&name);
            }
        }
        app_names.retain(|_, peer| map.contains_key(peer));
        app_ids.retain(|_, peer| map.contains_key(peer));
        direct_tunnels.retain(|_, peer| map.contains_key(peer));
        for bindings in [app_names, app_ids, direct_tunnels] {
            while bindings.len() > 2048 {
                let key = bindings.keys().next().cloned().unwrap();
                bindings.remove(&key);
            }
        }
        let mut out: Vec<P2pPeer> = map
            .iter()
            .filter(|(_, e)| e.online)
            .map(|(name, e)| {
                let name = name.clone();
                let e = e.clone();
                // 匿名接入条目（local:proto:port）显示为可读文案
                let node_id = if let Some(rest) = name.strip_prefix("local:") {
                    let mut it = rest.splitn(2, ':');
                    let proto = it.next().unwrap_or("tcp").to_uppercase();
                    let port = it.next().unwrap_or("");
                    format!("有玩家接入（{} :{}）", proto, port)
                } else {
                    name
                };
                P2pPeer {
                    node_id,
                    direction: if e.outbound {
                        "out".to_string()
                    } else {
                        "in".to_string()
                    },
                    transport: if e.transport.is_empty() {
                        "direct".to_string()
                    } else {
                        e.transport
                    },
                    ports: e.ports,
                    last_seen: e.last_seen,
                    app_id: e.app_id,
                    latency_ms: e.latency_ms,
                    latency_updated_at: e.latency_updated_at,
                    latency_stale: e
                        .latency_stamp
                        .map(|stamp| now_ms < stamp || now_ms - stamp > PEER_LATENCY_STALE_MS)
                        .unwrap_or(false),
                    latency_source: e.latency_source,
                }
            })
            .collect();
        // 最近活跃的排在前面
        out.sort_by(|a, b| {
            b.last_seen
                .cmp(&a.last_seen)
                .then_with(|| a.node_id.cmp(&b.node_id))
        });
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_log_fixtures() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/p2p/log-cases.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let peers = parse_p2p_peers_at(
                case["log"].as_str().unwrap(),
                log_time_ms(case["now"].as_str().unwrap()).unwrap(),
            );
            let expected = case["expected"].as_array().unwrap();
            assert_eq!(peers.len(), expected.len(), "{}", case["name"]);
            let actual = serde_json::to_value(peers).unwrap();
            for wanted in expected {
                let peer = actual
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["nodeId"] == wanted["nodeId"])
                    .unwrap();
                for (key, value) in wanted.as_object().unwrap() {
                    if value.is_number() {
                        assert_eq!(
                            peer[key].as_f64(),
                            value.as_f64(),
                            "{} / {}",
                            case["name"],
                            key
                        );
                    } else {
                        assert_eq!(&peer[key], value, "{} / {}", case["name"], key);
                    }
                }
            }
        }
    }
    #[test]
    fn dates_and_arbitrary_unicode_are_not_panics() {
        assert!(log_time_ms("2026/02/31 12:00:00").is_none());
        assert!(log_time_ms("2026/09/29 25:00:00").is_none());
        assert!(parse_p2p_peers_at("中文🙂/任意输入 no log", 0).is_empty());
    }
    #[test]
    fn tracker_keeps_identity_when_next_log_chunk_only_has_heartbeat() {
        let mut tracker = P2pPeerTracker::default();
        let now = log_time_ms("2026/09/29 12:00:20").unwrap();
        tracker.feed("2026/09/29 12:00:00 1 INFO addApp 9001 to room-a::0 end\n2026/09/29 12:00:01 1 DEBUG appid:9001 buildDirectTunnel ok. 9001 use tid 7001\n", now);
        let peers = tracker.feed(
            "2026/09/29 12:00:10 1 Dev 7001 read tunnel heartbeat ack, rtt=27ms\n",
            now,
        );
        assert_eq!(peers[0].node_id, "room-a");
        assert_eq!(peers[0].latency_ms, Some(27.0));
        assert!(tracker
            .feed("2026/09/29 12:00:11 2 INFO P2PNetwork init start\n", now)
            .is_empty());
    }
}
