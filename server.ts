import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  LEAD_COLUMNS,
  FULL_COLUMNS,
  buildCsv,
  downloadSlug,
  jobStore,
  validateJobBody,
} from './src/server/jobStore.ts';
import { findCities, geocodePlace, getBusinessTypes } from './src/server/presets.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Google Maps Scraper Kit Engine',
    version: '2.1.0',
    description:
      'Create a scrape job, poll its Status until ok or failed, inspect leads in the browser, or download Full CSV, Leads CSV, and JSON.',
  },
  paths: {
    '/api/v1/jobs': {
      get: { summary: 'List all scrape jobs, newest first' },
      post: {
        summary: 'Create a scrape job; returns 201 { id } or 422 { code, message }',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'keywords', 'lang', 'max_time'],
                properties: {
                  name: { type: 'string' },
                  keywords: { type: 'array', items: { type: 'string' } },
                  lang: { type: 'string', example: 'en' },
                  country: { type: 'string', example: 'us' },
                  lat: { type: 'string', example: '30.2672' },
                  lon: { type: 'string', example: '-97.7431' },
                  zoom: { type: 'integer', default: 15 },
                  depth: { type: 'integer', default: 5 },
                  grid: { type: 'integer', default: 1, description: '1-4 (splits city into NxN tiles)' },
                  max_time: { type: 'integer', default: 600 },
                  email: { type: 'boolean', default: true },
                  verify_emails: { type: 'boolean', default: false },
                  socials: { type: 'boolean', default: true },
                  tech: { type: 'boolean', default: true },
                  reviews_max: { type: 'integer', default: 0 },
                  proxies: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/jobs/{id}': {
      get: { summary: 'Get job status, progress, and masked configuration' },
      delete: { summary: 'Cancel (if working) and delete a job and its results' },
    },
    '/api/v1/jobs/{id}/rows': {
      get: { summary: 'Get parsed JSON rows and summary statistics for the job' },
    },
    '/api/v1/jobs/{id}/enrich-emails': {
      post: { summary: 'Run deep multi-page email extraction on rows with websites missing emails' },
    },
    '/api/v1/jobs/{id}/download': {
      get: {
        summary: 'Download results as CSV (?format=csv), Leads CSV (?format=leads), or JSON (?format=json)',
      },
    },
    '/api/v1/cities': {
      get: { summary: 'Autocomplete up to 20 cities from GeoNames dataset (?q=austin)' },
    },
    '/api/v1/business-types': {
      get: { summary: 'List 200+ preset business categories' },
    },
    '/api/v1/geocode': {
      get: { summary: 'Geocode any custom city or region via OpenStreetMap Nominatim (?q=Austin, TX)' },
    },
  },
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/openapi.json', (_req, res) => {
    res.json(OPENAPI_SPEC);
  });

  app.get('/api/v1/business-types', (_req, res) => {
    res.json(getBusinessTypes());
  });

  app.get('/api/v1/cities', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(findCities(q, 20));
  });

  app.get('/api/v1/geocode', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q.trim()) {
      return res.status(400).json({ code: 400, message: 'missing q parameter' });
    }
    const geo = await geocodePlace(q);
    if (!geo) {
      return res.status(404).json({ code: 404, message: 'location not found' });
    }
    return res.json(geo);
  });

  app.get('/api/v1/jobs', (_req, res) => {
    res.json(jobStore.list());
  });

  app.post('/api/v1/jobs', (req, res) => {
    try {
      const { name, data } = validateJobBody(req.body);
      const id = jobStore.create(name, data);
      return res.status(201).json({ id });
    } catch (err) {
      return res.status(422).json({
        code: 422,
        message: err instanceof Error ? err.message : 'invalid job payload',
      });
    }
  });

  app.get('/api/v1/jobs/:id', (req, res) => {
    const job = jobStore.get(req.params.id);
    if (!job) return res.status(404).json({ code: 404, message: 'job not found' });
    return res.json(job);
  });

  app.delete('/api/v1/jobs/:id', (req, res) => {
    if (!jobStore.delete(req.params.id)) {
      return res.status(404).json({ code: 404, message: 'job not found' });
    }
    return res.json({ message: 'deleted' });
  });

  app.get('/api/v1/jobs/:id/rows', (req, res) => {
    const job = jobStore.get(req.params.id);
    if (!job) return res.status(404).json({ code: 404, message: 'job not found' });
    const rows = jobStore.getRows(req.params.id) || [];
    return res.json({ job, rows });
  });

  app.post('/api/v1/jobs/:id/enrich-emails', async (req, res) => {
    const result = await jobStore.startEmailEnrichment(req.params.id);
    if (!result.started) {
      const status = result.reason === 'job not found' ? 404 : 409;
      return res.status(status).json({ code: status, message: result.reason || 'could not start email enrichment' });
    }
    return res.status(202).json(result);
  });

  app.get('/api/v1/jobs/:id/download', (req, res) => {
    const job = jobStore.get(req.params.id);
    if (!job) return res.status(404).json({ code: 404, message: 'job not found' });
    const rows = jobStore.getRows(req.params.id) || [];
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: 'no results yet for this job' });
    }

    const fmt = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'csv';
    const slug = downloadSlug(job);

    if (fmt === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}.json"`);
      return res.send(JSON.stringify(rows, null, 2));
    }

    const cols = fmt === 'leads' ? LEAD_COLUMNS : FULL_COLUMNS;
    const suffix = fmt === 'leads' ? '-leads.csv' : '.csv';
    const csv = buildCsv(rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}${suffix}"`);
    return res.send(csv);
  });

  if (IS_PROD) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      try {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const template = fs.readFileSync(htmlPath, 'utf-8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(transformed);
      } catch (e) {
        next(e);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Google Maps Scraper Kit server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
