import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import Stripe from 'stripe';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const productsFilePath = path.join(__dirname, 'products.json');
const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? '';
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? '';
const stripeConfigured = Boolean(stripeSecretKey);
const shopifyStoreDomain = process.env.SHOPIFY_STORE_DOMAIN ?? ''; // e.g. hexagon-store-3.myshopify.com
const shopifyAccessToken = process.env.SHOPIFY_ACCESS_TOKEN ?? '';
const shopifyWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';
const shopifyApiVersion = process.env.SHOPIFY_API_VERSION ?? '2024-01';

if (!stripeConfigured) {
	console.warn('STRIPE_SECRET_KEY is not set. PaymentIntents will be mocked.');
}

if (!shopifyStoreDomain || !shopifyAccessToken) {
	console.warn('Shopify credentials missing. Initial product sync will fail until SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN are provided.');
}

const stripe = stripeConfigured ? new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' }) : null;

const app = express();
const PORT = process.env.PORT || 3000;
let productsCache = [];

app.use(express.static(__dirname));

const shopifyWebhookMiddleware = express.raw({ type: 'application/json' });

app.post('/webhooks/shopify/products', shopifyWebhookMiddleware, async (req, res) => {
	if (!shopifyWebhookSecret) {
		console.warn('SHOPIFY_WEBHOOK_SECRET missing. Unable to verify webhook.');
		return res.status(500).end();
	}

	const hmacHeader = req.get('X-Shopify-Hmac-Sha256') ?? '';
	const digest = crypto.createHmac('sha256', shopifyWebhookSecret).update(req.body).digest('base64');
	const headerBuffer = Buffer.from(hmacHeader, 'base64');
	const digestBuffer = Buffer.from(digest, 'base64');

	if (headerBuffer.length !== digestBuffer.length || !crypto.timingSafeEqual(digestBuffer, headerBuffer)) {
		return res.status(401).send('Invalid HMAC');
	}

	try {
		await refreshProductsFromShopify('webhook');
		res.status(200).send('ok');
	} catch (error) {
		console.error('Failed to refresh products from webhook:', error);
		res.status(500).send('refresh failed');
	}
});

app.use(express.json());

app.get('/config', (_req, res) => {
	res.json({
		publishableKey: stripePublishableKey || null,
		stripeConfigured
	});
});

app.post('/agent', async (req, res) => {
	try {
		const { query } = req.body ?? {};

		if (!query || typeof query !== 'string') {
			return res.status(400).json({ error: 'Missing query' });
		}

		const products = await loadProducts();
		const product = selectProduct(products, query);

		if (!product) {
			return res.status(404).json({ error: 'No available products match the request' });
		}

			const paymentIntent = await createPaymentIntent(100, product.id);

			return res.json({
				product: {
					title: product.title,
					description: product.description,
					image: product.image,
					price_display: product.price_display ?? 'Price unavailable'
				},
				payment_intent_client_secret: paymentIntent.client_secret
			});
	} catch (error) {
		console.error('Agent error:', error);
		return res.status(500).json({ error: 'Agent failed to complete request' });
	}
});

app.listen(PORT, () => {
	console.log(`Agent demo listening on port ${PORT}`);
});

async function loadProducts() {
	if (!productsCache.length) {
		try {
			const raw = await fs.readFile(productsFilePath, 'utf-8');
			productsCache = JSON.parse(raw);
		} catch (error) {
			console.warn('Failed to read products from disk, attempting Shopify fetch...', error);
			await refreshProductsFromShopify('lazy-load');
		}
	}

	const products = productsCache;

	return products
		.filter((product) => product?.status !== 'draft')
		.map((product) => {
			const inventory = Array.isArray(product?.variants)
				? product.variants.reduce((sum, variant) => sum + Number(variant?.inventory_quantity ?? 0), 0)
				: 0;

			return {
				...product,
				inventory
			};
		})
		.filter((product) => product.inventory > 0);
}

function selectProduct(products, query) {
	const keywords = tokenize(query);

	let bestProduct = null;
	let bestScore = -1;

	for (const product of products) {
		const searchTarget = buildSearchableString(product);
		const score = scoreProduct(keywords, searchTarget);

			if (score > bestScore) {
				bestProduct = {
					id: product.id,
					title: product.title,
					description: normalizeDescription(product.body_html),
					image: product.image?.src ?? product.images?.[0]?.src ?? '',
					tags: product.tags ?? '',
					product_type: product.product_type ?? '',
					price_display: formatPrice(getProductPrice(product))
				};
				bestScore = score;
			}
		}

	return bestProduct;
}

function tokenize(text) {
	return text
		.toLowerCase()
		.split(/[\s,]+/)
		.filter(Boolean);
}

function buildSearchableString(product) {
	const sections = [product.title, product.product_type, product.tags].filter(Boolean);
	return sections.join(' ').toLowerCase();
}

function scoreProduct(keywords, searchTarget) {
	return keywords.reduce((score, term) => (searchTarget.includes(term) ? score + 1 : score), 0);
}

function normalizeDescription(html = '') {
	const withoutTags = html.replace(/<[^>]+>/g, ' ');
	const decoded = decodeEntities(withoutTags);
	return decoded.replace(/\s+/g, ' ').trim();
}

function decodeEntities(text) {
	const entityMap = {
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&#39;': '\'',
		'&nbsp;': ' '
	};

	return text.replace(/&[a-z#0-9]+;/gi, (entity) => entityMap[entity] ?? entity);
}

async function createPaymentIntent(amountCents, productId) {
	if (!stripe) {
		return {
			id: `pi_mock_${productId}`,
			client_secret: 'pi_mock_client_secret'
		};
	}

	return stripe.paymentIntents.create({
		amount: amountCents,
		currency: 'usd',
		payment_method_types: ['card'],
		metadata: {
			productId: String(productId)
		}
		});
}

function getProductPrice(product) {
	const primaryVariant = Array.isArray(product.variants) ? product.variants[0] : null;
	const rawPrice = primaryVariant?.price;

	if (rawPrice == null) {
		return null;
	}

	const parsed = Number(rawPrice);
	return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(amount) {
	if (amount == null) {
		return null;
	}

	return `$${amount.toFixed(2)}`;
}

async function refreshProductsFromShopify(reason = 'manual') {
	if (!shopifyStoreDomain || !shopifyAccessToken) {
		throw new Error('Missing Shopify credentials');
	}

	console.log(`[${new Date().toISOString()}] Refreshing products via Shopify (${reason})`);
	const response = await fetch(`https://${shopifyStoreDomain}/admin/api/${shopifyApiVersion}/products.json`, {
		headers: {
			'X-Shopify-Access-Token': shopifyAccessToken,
			'Content-Type': 'application/json'
		}
	});

	if (!response.ok) {
		throw new Error(`Shopify API responded with ${response.status}`);
	}

	const data = await response.json();
	productsCache = data.products ?? [];
	await fs.writeFile(productsFilePath, JSON.stringify(productsCache, null, 2));
}

refreshProductsFromShopify('startup').catch((error) => {
	console.error('Initial Shopify sync failed:', error);
});

cron.schedule('* * * * *', () => {
	refreshProductsFromShopify('cron-1m').catch((error) => {
		console.error('Scheduled Shopify sync failed:', error);
	});
});
