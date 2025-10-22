// main.js
import { promises as fs } from 'fs';
import http from 'http';
import { program } from 'commander';
import { XMLBuilder } from 'fast-xml-parser';
import path from 'path';
import url from 'url';

// Commander: обов'язкові параметри
program
  .requiredOption('-i, --input <path>', 'path to input JSON file')
  .requiredOption('-h, --host <host>', 'server host')
  .requiredOption('-p, --port <port>', 'server port');

program.parse(process.argv);
const options = program.opts();

const inputPath = path.resolve(options.input);
const host = options.host;
const port = Number(options.port);

// Check file exists before starting server
async function checkInputFile(p) {
  try {
    await fs.access(p);
  } catch (err) {
    console.error('Cannot find input file');
    process.exit(1);
  }
}

function parseQuery(reqUrl) {
  const parsed = url.parse(reqUrl, true);
  return parsed.query;
}

function filterWeatherRecords(records, query) {
  // query.humidity === 'true' or undefined
  // query.min_rainfall -> numeric
  const minRain = query.min_rainfall !== undefined ? Number(query.min_rainfall) : null;
  const showHumidity = query.humidity === 'true';

  let filtered = records;
  if (!Number.isNaN(minRain) && minRain !== null) {
    filtered = filtered.filter(r => {
      const val = r.Rainfall;
      // if Rainfall missing or not number -> treat as 0 or skip? Keep only numeric > minRain
      return Number(val) > minRain;
    });
  }

  // Map to output fields: Rainfall, Pressure3pm, Humidity3pm (include humidity only if requested)
  const mapped = filtered.map(r => {
    const out = {
      rainfall: r.Rainfall !== undefined ? r.Rainfall : '',
      pressure3pm: r.Pressure3pm !== undefined ? r.Pressure3pm : ''
    };
    if (showHumidity) out.humidity = r.Humidity3pm !== undefined ? r.Humidity3pm : '';
    return out;
  });

  return mapped;
}

async function handleRequest(req, res) {
  try {
    const q = parseQuery(req.url);
    const raw = await fs.readFile(inputPath, 'utf8'); // async readFile
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // If JSON invalid — respond 500
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid JSON input file');
      return;
    }

    // Ensure data is array — if object -> try to find array field, otherwise wrap
    const records = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : [data]);

    const mapped = filterWeatherRecords(records, q);

    // Build XML: root <weather_data><record>...</record></weather_data>
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      indentBy: '  ',
      suppressEmptyNode: false
    });

    const xmlObj = {
      weather_data: {
        record: mapped.map(item => ({
          rainfall: item.rainfall,
          pressure3pm: item.pressure3pm,
          ...(item.humidity !== undefined ? { humidity: item.humidity } : {})
        }))
      }
    };

    const xml = builder.build(xmlObj);

    // Save the last response to file (demonstrate writeFile)
    await fs.writeFile(path.resolve('last_response.xml'), xml, 'utf8');

    // Send HTTP response
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);

  } catch (err) {
    console.error('Server error:', err);
    // If file not found here (race) — print Cannot find input file and 404
    if (err.code === 'ENOENT') {
      console.error('Cannot find input file');
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Cannot find input file');
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
}

async function start() {
  await checkInputFile(inputPath);

  const server = http.createServer((req, res) => {
    handleRequest(req, res);
  });

  server.listen(port, host, () => {
    console.log(`Server listening at http://${host}:${port}/`);
    console.log('Usage examples: /?humidity=true  or /?min_rainfall=2  or /?humidity=true&min_rainfall=2');
  });
}

start();
