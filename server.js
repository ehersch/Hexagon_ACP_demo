import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import Stripe from 'stripe';
import { fileURLToPath } from 'url';
import { startProductRefreshCron } from './product_refresh.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const productsFilePath = path.join(__dirname, 'products.json');
const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? '';
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? '';
const stripeConfigured = Boolean(stripeSecretKey);

if (!stripeConfigured) {
	console.warn('STRIPE_SECRET_KEY is not set. PaymentIntents will be mocked.');
}

const stripe = stripeConfigured ? new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' }) : null;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

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

startProductRefreshCron();

async function loadProducts() {
	const raw = await fs.readFile(productsFilePath, 'utf-8');
	const products = JSON.parse(raw);

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
