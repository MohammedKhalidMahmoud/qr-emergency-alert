const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'data', 'locations.json');
const DEFAULT_OUTPUT_MANIFEST = path.join(PROJECT_ROOT, 'out', 'sms-manifest.json');
const QR_LIBRARY_ROOT = path.join(PROJECT_ROOT, 'node_modules', 'qrcode', 'lib');

function main() {
  const configPath = getArgValue('--config') || DEFAULT_CONFIG_PATH;
  const config = readJson(configPath);
  const outputDir = path.resolve(PROJECT_ROOT, config.output?.directory || 'out/sms');
  const scale = Number(config.output?.scale || 8);
  const margin = Number(config.output?.margin || 4);
  const recipients = normalizeRecipients(config.smsRecipients || []);
  const locations = Array.isArray(config.locations) ? config.locations : [];
  const qrCode = loadQrcodeLibrary();

  if (recipients.length === 0) {
    throw new Error('No SMS recipients found in the config file.');
  }

  if (locations.length === 0) {
    throw new Error('No locations found in the config file.');
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = {
    project: config.project || 'QR Emergency Help - Track 1',
    generatedAt: new Date().toISOString(),
    recipients,
    messageTemplate: config.messageTemplate || 'Help at {name} ({id})',
    output: {
      directory: path.relative(PROJECT_ROOT, outputDir).replaceAll(path.sep, '/'),
      scale,
      margin
    },
    locations: []
  };

  for (const location of locations) {
    const normalizedLocation = normalizeLocation(location);
    const message = applyTemplate(config.messageTemplate || 'Help at {name} ({id})', normalizedLocation);
    const smsUri = buildSmsUri(recipients, message);
    const qrData = qrCode.create([{ data: smsUri, mode: 'byte' }], {
      errorCorrectionLevel: 'L'
    });
    const fileName = `${normalizedLocation.id}.png`;
    const filePath = path.join(outputDir, fileName);

    writePng(filePath, qrData.modules, scale, margin);

    manifest.locations.push({
      id: normalizedLocation.id,
      name: normalizedLocation.name,
      version: qrData.version,
      smsUri,
      file: path.relative(PROJECT_ROOT, filePath).replaceAll(path.sep, '/')
    });

    console.log(`${normalizedLocation.id} -> ${path.relative(PROJECT_ROOT, filePath).replaceAll(path.sep, '/')} (version ${qrData.version})`);
  }

  fs.mkdirSync(path.dirname(DEFAULT_OUTPUT_MANIFEST), { recursive: true });
  fs.writeFileSync(DEFAULT_OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Manifest -> ${path.relative(PROJECT_ROOT, DEFAULT_OUTPUT_MANIFEST).replaceAll(path.sep, '/')}`);
}

function loadQrcodeLibrary() {
  const cache = new Map();
  const dijkstraStub = {
    find_path(graph, start, end) {
      return findShortestPath(graph, start, end);
    }
  };

  function loadModule(filePath) {
    if (cache.has(filePath)) {
      return cache.get(filePath).exports;
    }

    const module = { exports: {} };
    cache.set(filePath, module);

    const code = fs.readFileSync(filePath, 'utf8');
    const dirname = path.dirname(filePath);

    const localRequire = (request) => {
      if (request === 'dijkstrajs') {
        return dijkstraStub;
      }

      if (!request.startsWith('.')) {
        throw new Error(`Unsupported dependency '${request}' while loading qrcode`);
      }

      return loadModule(resolveRelativeModule(dirname, request));
    };

    const wrapped = `(function (require, module, exports, __filename, __dirname) {\n${code}\n})`;
    const compiled = vm.runInThisContext(wrapped, { filename: filePath });
    compiled(localRequire, module, module.exports, filePath, dirname);
    return module.exports;
  }

  return loadModule(path.join(QR_LIBRARY_ROOT, 'core', 'qrcode.js'));
}

function resolveRelativeModule(baseDir, request) {
  const rawPath = path.resolve(baseDir, request);
  const candidates = [
    rawPath,
    `${rawPath}.js`,
    `${rawPath}.json`,
    path.join(rawPath, 'index.js')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(`Cannot resolve module '${request}' from '${baseDir}'`);
}

function findShortestPath(graph, start, end) {
  const distances = new Map([[start, 0]]);
  const previous = new Map();
  const visited = new Set();

  while (true) {
    let currentNode = null;
    let currentDistance = Number.POSITIVE_INFINITY;

    for (const [node, distance] of distances.entries()) {
      if (!visited.has(node) && distance < currentDistance) {
        currentNode = node;
        currentDistance = distance;
      }
    }

    if (currentNode === null) {
      break;
    }

    if (currentNode === end) {
      break;
    }

    visited.add(currentNode);
    const neighbors = graph[currentNode] || {};

    for (const [neighbor, weight] of Object.entries(neighbors)) {
      const candidateDistance = currentDistance + weight;

      if (!distances.has(neighbor) || candidateDistance < distances.get(neighbor)) {
        distances.set(neighbor, candidateDistance);
        previous.set(neighbor, currentNode);
      }
    }
  }

  if (!distances.has(end)) {
    return [];
  }

  const path = [];
  let current = end;

  while (current) {
    path.unshift(current);
    if (current === start) {
      break;
    }
    current = previous.get(current);
  }

  return path;
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRecipients(recipients) {
  return recipients
    .map((recipient) => String(recipient).trim().replace(/[^+\d]/g, ''))
    .filter((recipient) => recipient.length > 0);
}

function normalizeLocation(location) {
  const id = String(location.id || '').trim();
  const name = String(location.name || '').trim();

  if (!id) {
    throw new Error('Each location needs an id.');
  }

  if (!name) {
    throw new Error(`Location ${id} needs a name.`);
  }

  return { id, name };
}

function applyTemplate(template, location) {
  return String(template).replace(/\{(id|name)\}/g, (_, key) => location[key]);
}

function buildSmsUri(recipients, body) {
  return `sms:${recipients.join(',')}?body=${encodeURIComponent(body)}`;
}

function writePng(filePath, modules, scale, margin) {
  const moduleCount = modules.size;
  const width = (moduleCount + margin * 2) * scale;
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * width, 255);

  for (let row = 0; row < width; row += 1) {
    raw[row * rowLength] = 0;
  }

  for (let moduleRow = 0; moduleRow < moduleCount; moduleRow += 1) {
    for (let moduleCol = 0; moduleCol < moduleCount; moduleCol += 1) {
      if (!modules.get(moduleRow, moduleCol)) {
        continue;
      }

      const startY = (margin + moduleRow) * scale;
      const startX = (margin + moduleCol) * scale;

      for (let y = 0; y < scale; y += 1) {
        const rowOffset = (startY + y) * rowLength + 1 + startX * 4;

        for (let x = 0; x < scale; x += 1) {
          const pixelOffset = rowOffset + x * 4;
          raw[pixelOffset] = 0;
          raw[pixelOffset + 1] = 0;
          raw[pixelOffset + 2] = 0;
          raw[pixelOffset + 3] = 255;
        }
      }
    }
  }

  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', buildIhdr(width, width)),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(filePath, png);
}

function buildIhdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 1) !== 0) {
        crc = 0xedb88320 ^ (crc >>> 1);
      } else {
        crc >>>= 1;
      }
    }

    table[index] = crc >>> 0;
  }

  return table;
})();

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

main();
