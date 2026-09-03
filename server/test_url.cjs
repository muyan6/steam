const axios = require('axios');

async function check() {
  try {
    const res = await axios.get('https://store.steampowered.com/app/4704690/', {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      timeout: 10000
    });
    console.log('HTML Length:', res.data.length);
    
    // Look for image urls
    const imgMatches = res.data.match(/https:\/\/[^"'\s]+\.(?:jpg|png|webp)/gi) || [];
    const uniqueImgs = [...new Set(imgMatches)].filter(u => u.includes('4704690') || u.includes('steamstatic') || u.includes('steamcommunity'));
    console.log('Found images:', uniqueImgs.slice(0, 15));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

check();
