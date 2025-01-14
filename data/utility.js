import { existsSync } from 'fs';
import { readFile, writeFile } from 'atomically';
import { platform } from 'os';
import path from 'path';
import { URL } from 'url';
import got from 'got';
import lockfile from 'proper-lockfile';

export const CACHE_DIR = path.join('data', 'cache');
export const OUTPUT_DIR = path.join('public', 'data');
export const INVENTORY_FILE = path.join(OUTPUT_DIR, 'inventory.json');
export const PARTIAL_INVENTORIES = Object.fromEntries([
  'topology',
  'gfs',
  'geos',
  'oscar',
  'rtgssthr',
].map(source => [source, path.join(OUTPUT_DIR, `inventory-${source}.json`)]));

const windows = (platform() === 'win32');

// join paths with ISO dates in a safe way for windows
export function join(...args) {
  let newPath = path.join(...args);
  return windows ? newPath.replace(/:/g, '_' ) : newPath;
}

// converts local file system path to path for browser to use in a fetch call
//
// Example: public/data/topology.json => /data/topology.json
export function browserPath(outputPath) {
  return '/' + outputPath.split(path.sep).slice(1).join('/');
}

// pretty prints a file transformation operation
//
// - message is a string
// - input is a string or array of strings
// - output is a string or array of strings
//
// Example print:
//
// Generating topology...
// <= data/cache/ne_50m_graticules_10.shp
// <= data/cache/ne_50m_rivers_lake_centerlines.shp
// <= data/cache/ne_50m_lakes.shp
// <= data/cache/ne_50m_coastline.shp
// => public/data/topology.json
export function log(message, input=[], output=[]) {
  console.log(`${message}...`);

  input = Array.isArray(input) ? input : [input];
  for (const i of input) console.log(`<= ${i}`);

  output = Array.isArray(output) ? output : [output];
  for (const o of output) console.log(`=> ${o}`);

  console.log();
}

// downloads a file from url if it doesn't already exist in cache
//
// - set prefix to true if you want the whole URL in the file save path
// - suffix is appended to file save path
// - headers are sent with the request (used for HTTP range requests)
// - downloadFn is the got-compatible function used download the data; can pass
//   a throttled version of got to rate-limit api calls
//
// returns a Promise that resolves to the path where file was saved to
export async function download(
  url, prefix=false, suffix='', headers={}, downloadFn=got
) {
  url = new URL(url);

  let filename;
  if (prefix) {
    let fowardSlash = /\//g;
    filename = url.toString()
      .replace('://', '-')
      .replace(fowardSlash, '-')
      + suffix;
  } else {
    filename = path.basename(url.pathname);
  }
  let filepath = path.join(CACHE_DIR, filename);

  if (existsSync(filepath)) {
    log('Exists in cache, not re-downloading', [], filepath);
  } else {
    log('Downloading', url, filepath);
    try {
      let res = await downloadFn(url, {
        headers: headers,
        timeout: { request: 8 * 60_000 }, // give up after 8 minutes
      });
      await writeFile(filepath, res.rawBody);
    } catch(err) {
      console.log(`Failed to download... ${url}\n=> ${err}`);
      throw err;
    }
  }
  return filepath;
}

// read the partial inventory for a data source
//
// - source is the name of the data source (e.g. 'gfs')
//
// returns the partial inventory object and a callback for writing to the full
// inventory, ensuring (hopefully!) that different processes running this
// function do not cause data loss
export async function readPartialInventory(source) {
  let file = PARTIAL_INVENTORIES[source];

  // prevent multiple concurrent runs of a specific data source
  let releasePartialInventory;
  try {
    releasePartialInventory = await lockfile.lock(file);
  } catch(e) {
    if (e.code === 'ELOCKED') {
      console.error(
        'Data already processing for this source, please try again later.',
        '\nUse `systemctl list-timers` to see the processing schedule.'
      );
      process.exit(1);
    }
    throw(e)
  }
  let partialInventory = JSON.parse(await readFile(file, 'utf8'));

  let writeInventory = async partialInventory => {
    await writeFile(file, JSON.stringify(partialInventory, null, 2));
    await releasePartialInventory();

    // merge all partial inventories together to recreate/update main inventory
    let releaseInventory = await lockfile.lock(INVENTORY_FILE, { retries: 8 });
    let inventory = [];
    for (const file of Object.values(PARTIAL_INVENTORIES)) {
      inventory.push(...JSON.parse(await readFile(file, 'utf8')));
    }
    await writeFile(INVENTORY_FILE, JSON.stringify(inventory, null, 2));
    await releaseInventory();
  };

  return [partialInventory, writeInventory];
}

// check if a URL exists (without having to download the whole file)
//
// intentionally strict as to not be mistaken for the cause of errors
export async function exists(url) {
  const response = await got(url, { method: 'HEAD', throwHttpErrors: false });
  return response.statusCode !== 404;
}
