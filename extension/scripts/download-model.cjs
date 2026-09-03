const https = require('https');
const fs = require('fs');
const path = require('path');

const URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const DEST = path.join(__dirname, '..', 'public', 'models', 'blaze_face_short_range.tflite');

function download(url, dest, redirectCount = 0) {
  if (redirectCount > 5) {
    console.error('Too many redirects');
    process.exit(1);
  }

  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      console.log('Following redirect to:', res.headers.location);
      download(res.headers.location, dest, redirectCount + 1);
      return;
    }

    if (res.statusCode !== 200) {
      console.error('HTTP', res.statusCode);
      process.exit(1);
    }

    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(dest, buffer);
      console.log(`Downloaded ${buffer.length} bytes to ${dest}`);
    });
  }).on('error', (err) => {
    console.error('Download failed:', err.message);
    process.exit(1);
  });
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });
download(URL, DEST);
