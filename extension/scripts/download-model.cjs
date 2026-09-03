const https = require('https');
const fs = require('fs');
const path = require('path');

const MODELS = [
  {
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    dest: path.join(__dirname, '..', 'public', 'models', 'blaze_face_short_range.tflite'),
  },
  {
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
    dest: path.join(__dirname, '..', 'public', 'models', 'efficientdet_lite0.tflite'),
  },
  {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    dest: path.join(__dirname, '..', 'public', 'models', 'face_landmarker.task'),
  },
];

function download(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log('  Following redirect to:', res.headers.location);
        download(res.headers.location, dest, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(dest, buffer);
        console.log(`  Downloaded ${buffer.length} bytes to ${dest}`);
        resolve();
      });
    }).on('error', reject);
  });
}

async function main() {
  for (const { url, dest } of MODELS) {
    if (fs.existsSync(dest)) {
      console.log(`Already exists: ${dest} — skipping`);
      continue;
    }
    console.log(`Downloading: ${path.basename(dest)}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      await download(url, dest);
    } catch (err) {
      console.error('  Failed:', err.message);
      process.exit(1);
    }
  }
  console.log('All models ready.');
}

main();
