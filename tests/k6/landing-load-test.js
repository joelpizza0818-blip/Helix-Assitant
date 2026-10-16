import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const failedRequests = new Rate('failed_requests');
const responseBodyBytes = new Counter('response_body_bytes');
const criticalPageWeight = new Trend('critical_page_weight_bytes');
const mediaAssetWeight = new Trend('media_asset_weight_bytes');
const landingMediaWeight = new Trend('landing_media_weight_bytes');

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    failed_requests: ['rate<0.01'],
    critical_page_weight_bytes: ['p(95)<1000000'],
  },
};

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const fetchedCriticalAssets = new Set();
const checkedMediaAssets = new Set();
let criticalPageWeightRecorded = false;
let landingMediaWeightRecorded = false;

function bodyBytes(response) {
  const contentLength = Number(response.headers['Content-Length']);
  if (Number.isFinite(contentLength)) return contentLength;
  return response.body ? new TextEncoder().encode(response.body).length : 0;
}

function checkStatus(response, label) {
  const passed = check(response, {
    [`${label} returns HTTP 200`]: (result) => result.status === 200,
  });
  failedRequests.add(!passed);
  responseBodyBytes.add(bodyBytes(response), { resource: label });
  return passed;
}

function localAssetPaths(html, expression) {
  const paths = new Set();
  let match;
  while ((match = expression.exec(html)) !== null) {
    const path = match[1];
    if (path.startsWith('/') && !path.startsWith('//')) paths.add(path);
  }
  return [...paths];
}

function mediaPaths(script) {
  const paths = new Set();
  const expression = /(["'])(\/assets\/[^"'\\\s]+\.(?:mp4|jpe?g|png|webp)(?:\?[^"'\\\s]*)?)\1/gi;
  let match;
  while ((match = expression.exec(script)) !== null) paths.add(match[2]);
  return [...paths];
}

export default function () {
  group('landing document and critical assets', () => {
    const page = http.get(`${BASE_URL}/`);
    const pageOk = checkStatus(page, 'landing_html') && check(page, {
      'HTML contains HELIX title': (response) => response.body && response.body.includes('HELIX'),
    });
    failedRequests.add(!pageOk);
    if (!pageOk) return;

    let pageWeight = bodyBytes(page);
    let criticalAssetsSucceeded = true;
    let mediaAssetsSucceeded = true;
    let mediaWeight = 0;
    let foundMediaAsset = false;
    const scripts = localAssetPaths(
      page.body,
      /<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi,
    );
    const stylesheets = localAssetPaths(
      page.body,
      /<link\b[^>]*\bhref=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi,
    );
    const hasCriticalAssets = check(page, {
      'HTML references a same-origin JavaScript bundle': () => scripts.length > 0,
      'HTML references a same-origin stylesheet': () => stylesheets.length > 0,
    });
    failedRequests.add(!hasCriticalAssets);
    if (!hasCriticalAssets) return;

    for (const assetPath of [...scripts, ...stylesheets]) {
      if (fetchedCriticalAssets.has(assetPath)) continue;
      const asset = http.get(`${BASE_URL}${assetPath}`);
      const assetOk = checkStatus(asset, assetPath);
      if (!assetOk) {
        criticalAssetsSucceeded = false;
        continue;
      }
      pageWeight += bodyBytes(asset);
      if (assetPath.endsWith('.js')) {
        for (const mediaPath of mediaPaths(asset.body)) {
          if (checkedMediaAssets.has(mediaPath)) continue;
          checkedMediaAssets.add(mediaPath);
          const media = http.request('HEAD', `${BASE_URL}${mediaPath}`);
          const mediaOk = check(media, {
            [`${mediaPath} is published`]: (response) => (
              response.status === 200
              && Number(response.headers['Content-Length']) > 0
            ),
          });
          failedRequests.add(!mediaOk);
          const mediaBytes = Number(media.headers['Content-Length']) || 0;
          if (mediaOk && mediaBytes > 0) {
            mediaAssetWeight.add(mediaBytes, {
            asset: mediaPath.split('.').pop().split('?')[0],
            });
            mediaWeight += mediaBytes;
            foundMediaAsset = true;
          } else {
            mediaAssetsSucceeded = false;
          }
        }
      }
      fetchedCriticalAssets.add(assetPath);
    }

    if (!criticalPageWeightRecorded && criticalAssetsSucceeded) {
      criticalPageWeight.add(pageWeight);
      criticalPageWeightRecorded = true;
    }
    if (
      !landingMediaWeightRecorded
      && mediaAssetsSucceeded
      && foundMediaAsset
    ) {
      landingMediaWeight.add(mediaWeight);
      landingMediaWeightRecorded = true;
    }
  });

  sleep(1);
}
