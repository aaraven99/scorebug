import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const scriptTag = '<script type="module" src="/web-analytics/start.js"></script>';

function analyticsOptions(environment) {
  let configuration;
  try {
    configuration = JSON.parse(environment.VERCEL_OBSERVABILITY_CLIENT_CONFIG || '{}').analytics;
  } catch {
    // The SDK's standard same-origin endpoints work without dynamic config.
    return {};
  }
  const options = {};
  for (const key of ['scriptSrc', 'viewEndpoint', 'eventEndpoint', 'sessionEndpoint']) {
    const value = configuration?.[key];
    // Only expose the public same-origin paths, never the whole build environment.
    if (typeof value === 'string' && /^\/(?!\/)[^\s\\]*$/.test(value)) options[key] = value;
  }
  return options;
}

export async function addWebAnalytics(outputDirectory, environment = process.env) {
  if (environment.VERCEL_ENV !== 'production') return false;

  const assets = new URL('web-analytics/', outputDirectory);
  await mkdir(assets, { recursive: true });
  // The official vanilla entry is already a standalone browser ES module.
  await cp(new URL(import.meta.resolve('@vercel/analytics')), new URL('vercel-analytics.js', assets));
  await cp(new URL('LICENSE', import.meta.resolve('@vercel/analytics/package.json')), new URL('LICENSE.txt', assets));
  await cp(new URL('web-analytics.mjs', import.meta.url), new URL('runtime.js', assets));
  const configuration = JSON.stringify({ environment: 'production', options: analyticsOptions(environment) });
  await writeFile(new URL('start.js', assets), [
    "import { inject } from './vercel-analytics.js';",
    "import { startWebAnalytics } from './runtime.js';",
    `startWebAnalytics(inject, ${configuration});`,
    ''
  ].join('\n'));

  for (const page of ['index.html', 'widget.html', 'game.html']) {
    const file = new URL(page, outputDirectory);
    const html = await readFile(file, 'utf8');
    if (!html.includes(scriptTag)) await writeFile(file, html.replace('</head>', `${scriptTag}</head>`));
  }
  return true;
}
