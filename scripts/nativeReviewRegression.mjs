#!/usr/bin/env node
// Compile production-only pure functions, avoiding the Tauri GUI/DLL test harness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.env.REVIEW_PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'native-review-'));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const rustPath = f => JSON.stringify(path.join(root, f).replaceAll('\\', '/'));
const local = read('src-tauri/src/localgames.rs'), online = read('src-tauri/src/onlinefix.rs');
const restore = local.slice(local.indexOf('pub fn restore_original_game('), local.indexOf('pub fn is_spacewar_installed('));
const backups = online.slice(online.indexOf('pub(crate) fn restore_patch_backups('), online.indexOf('/// 解压 zip 归档到目标目录'));
const build = read('src-tauri/build.rs').split('fn main()')[0];
const source = `use std::fs; use std::path::{Path,PathBuf};
#[path=${rustPath('src-tauri/src/file_restore.rs')}] mod file_restore;
#[path=${rustPath('src-tauri/src/dict_parser.rs')}] mod dict_parser;
mod onlinefix { use std::fs; use std::path::Path; const PATCH_BACKUP_DIR:&str=".cfd_patch_backup"; ${backups} }
mod build_probe { ${build} pub fn run(){regenerate_game_dict();} }
${restore}
` + String.raw`
fn main() {
    let root=PathBuf::from(std::env::args().nth(1).unwrap());
    let game=root.join("game"); let nested=game.join("Binaries/Win64");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("steam_appid.txt"),"480").unwrap();
    fs::write(nested.join("steam_appid.txt.cfd_bak"),"12345").unwrap();
    restore_original_game(&game).unwrap();
    assert_eq!(fs::read_to_string(nested.join("steam_appid.txt")).unwrap(),"12345");
    assert!(!nested.join("steam_appid.txt.cfd_bak").exists());
    println!("PASS R09 actual restore_original_game restores nested AppID backup");
    let mut bytes=b"CFGD\x01\x01\0\0\0".to_vec();
    bytes.extend_from_slice(&[0x80,0x80,0x80,0x80,0x10,1,0,b'A',0,0]);
    assert!(dict_parser::parse_binary_dict(&bytes).is_empty());
    let bad_utf8=b"CFGD\x01\x01\0\0\0\x01\x01\0\xff\0\0";
    assert!(dict_parser::parse_binary_dict(bad_utf8).is_empty());
    let duplicate=b"CFGD\x01\x02\0\0\0\x01\x01\0A\0\0\0\x01\0B\0\0";
    assert!(dict_parser::parse_binary_dict(duplicate).is_empty());
    println!("PASS R12 invalid dictionary overflow, UTF-8 and duplicate IDs rejected");
    std::env::set_current_dir(root.join("build/src-tauri")).unwrap();
    build_probe::run();
    assert!(Path::new("regenerated.marker").exists());
    println!("PASS R14 Chinese-only source update regenerates embedded dictionary");
    println!("NATIVE_REVIEW_RESULT passed=3 failed=0");
}
`;
// String.raw preserves backslashes; the byte literals above need one Rust escape level.
const fixedSource = source.replaceAll('\\\\x', '\\x').replaceAll('\\\\0', '\\0');
for (const d of ['build/src-tauri/data', 'build/server/data', 'build/server/scripts']) fs.mkdirSync(path.join(out, d), { recursive: true });
for (const [f, time] of [['build/server/data/steam_all_games.json', 1000], ['build/src-tauri/data/game_dict.bin', 2000], ['build/server/data/chinese_games_cache.json', 3000]]) {
  fs.writeFileSync(path.join(out, f), 'fixture'); fs.utimesSync(path.join(out, f), time, time);
}
const generator = path.join(out, 'build/server/scripts/build-game-dict.mjs');
fs.writeFileSync(generator, "import fs from 'node:fs';fs.writeFileSync('regenerated.marker','yes');"); fs.utimesSync(generator, 500, 500);
const rs = path.join(out, 'probe.rs'), exe = path.join(out, 'probe.exe'); fs.writeFileSync(rs, fixedSource);
const compiled = spawnSync('rustc', ['--edition=2021', '--crate-name', 'native_review', '-A', 'warnings', rs, '-o', exe], { encoding: 'utf8', timeout: 120000 });
assert.equal(compiled.status, 0, compiled.stderr);
const result = spawnSync(exe, [out], { encoding: 'utf8', timeout: 30000 });
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'production native regression failed');
