const https = require('https');
const fs = require('fs');

const DEFAULT_KEY = Buffer.from('QVEuQWI4Uk42SlVuQlgwNjBmTlVGVHVhWkVDQUVZQktsNHlObFhyT1U5VDFUdnRWNll1TkE=', 'base64').toString('ascii');
const API_KEY = process.env.VERTEX_API_KEY || DEFAULT_KEY;
const PROJECT = 'gen-lang-client-0356788890';
const LOCATIONS = ['global', 'us-central1'];

const models = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
const apiVersions = ['v1', 'v1beta1'];

function checkModel(ver, model, location) {
  return new Promise((resolve) => {
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    const path = `/${ver}/projects/${PROJECT}/locations/${location}/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(API_KEY)}`;
    const req = https.request({
      hostname: host,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let live = false;
        try {
          const j = JSON.parse(data);
          if (j.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
            live = true;
          }
        } catch (e) {}
        resolve({ ver, model, location, status: res.statusCode, live });
      });
    });
    req.on('error', (e) => resolve({ ver, model, location, status: 'ERROR', live: false }));
    req.write(JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Ping test' }] }],
      generation_config: {
        response_modalities: ['AUDIO'],
        speech_config: {
          voice_config: { prebuilt_voice_config: { voice_name: 'Algieba' } }
        }
      }
    }));
    req.end();
  });
}

async function main() {
  console.log(`[${new Date().toISOString()}] Checking Vertex AI 3.8 TTS Status...`);
  const liveModels = [];
  for (const m of models) {
    for (const loc of LOCATIONS) {
      for (const v of apiVersions) {
        const res = await checkModel(v, m, loc);
        console.log(`  ${loc.padEnd(10)} | ${v.padEnd(8)} | ${m.padEnd(26)} | HTTP ${res.status} (live: ${res.live})`);
        if (res.live && !liveModels.includes(m)) {
          liveModels.push(m);
        }
      }
    }
  }

  if (liveModels.length > 0) {
    console.log(`\n🎉 FOUND LIVE 3.8 MODELS: ${liveModels.join(', ')}`);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `is_live=true\nmodels=${liveModels.join(', ')}\n`);
    }
  } else {
    console.log(`\n⏳ 3.8 models not yet live on Vertex AI.`);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `is_live=false\n`);
    }
  }
}

main();
