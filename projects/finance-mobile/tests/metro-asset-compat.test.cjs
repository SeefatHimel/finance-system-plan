const assert = require('node:assert/strict');
const test = require('node:test');

test('Metro can use the locked image-size API when bundling PNG assets', () => {
  const metroAssetsPath = require.resolve('metro/src/Assets');
  const imageSizePath = require.resolve('image-size', { paths: [metroAssetsPath] });
  const getImageSize = require(imageSizePath);

  assert.equal(typeof getImageSize, 'function');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4Z5sAAAAASUVORK5CYII=',
    'base64',
  );
  assert.deepEqual(getImageSize(png), { width: 1, height: 1, type: 'png' });
});
