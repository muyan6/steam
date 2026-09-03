const fs = require('fs');
const path = require('path');

const content = `-- SteamMaster 自动生成的入库规则
-- Game: 致命公司 (AppID: 1966720)

-- 1. 挂载主游戏本体 License (伪造拥有权)
addappid(1966720)

-- 3. 注入分包解密密钥 (Depot Decryption Keys)
set_depot_key(1966720, "b1b18f9400b7b45bb7d3223ca7951a73cc2bdf0cb311e5b1a337e9c776c7ac7d")
addappid(1966721)
addappid(1966741, 0, "bc74e91b9354ae030c95c89654e95587a1e3560bbc254f371a80d3672d379d3a")
set_depot_key(1966741, "bc74e91b9354ae030c95c89654e95587a1e3560bbc254f371a80d3672d379d3a")
addappid(1966781, 0, "4454042304ade506788cbff08231a4c390c2cc2e49d50e0c1be144f5b278b6c9")
set_depot_key(1966781, "4454042304ade506788cbff08231a4c390c2cc2e49d50e0c1be144f5b278b6c9")
addappid(1966801, 0, "48bc30d6edf172a77378b9997fe08822b26e4f6b21059bd8619dd1e9829ccb9d")
set_depot_key(1966801, "48bc30d6edf172a77378b9997fe08822b26e4f6b21059bd8619dd1e9829ccb9d")
`;

['e:/steam/config/lua/app_1966720.lua', 'e:/steam/config/stplug-in/app_1966720.lua', 'e:/steam/st_scripts/app_1966720.lua'].forEach(f => {
  const dir = path.dirname(f);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, content, 'utf-8');
  console.log('Updated:', f);
});


// Verify OpenSteamTool files are in e:\steam
['dwmapi.dll', 'xinput1_4.dll', 'OpenSteamTool.dll'].forEach(f => {
  const p = 'e:/steam/' + f;
  console.log(f, fs.existsSync(p) ? fs.statSync(p).size : 'MISSING');
});

// Launch Steam
setTimeout(() => {
  const child = spawn('e:\\steam\\steam.exe', [], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('Steam launched with PID:', child.pid);

  setTimeout(() => {
    try {
      const ps32 = 'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe';
      const cmd = `"${ps32}" -NoProfile -Command "Get-Process -Name steam | Select-Object -ExpandProperty Modules | Select-Object -ExpandProperty FileName"`;
      const out = execSync(cmd).toString();
      const list = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const matched = list.filter(f => /dwmapi|opensteam|xinput|version/i.test(f));
      console.log('\n--- Hook modules loaded in Steam: ---');
      console.log(matched);
    } catch(e) {
      console.log('Check error:', e.message);
    }
  }, 10000);
}, 2000);

