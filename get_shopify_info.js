import '@shopify/shopify-api/adapters/node';

import {shopifyApi, ApiVersion} from '@shopify/shopify-api';
import express from 'express';
import { writeFileSync } from 'fs';
import process from 'process';

const shopify = shopifyApi({
  // The next 4 values are typically read from environment variables for added security
  apiKey: process.env.API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ['read_products'],
  hostName: 'ngrok-tunnel-address',
  apiVersion: ApiVersion.July25
});

const app = express();
const SHOP = 'hexagon-store-3';
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const res = await fetch(`https://${SHOP}.myshopify.com/admin/api/2024-01/products.json`, {
  headers: {
    'X-Shopify-Access-Token': SHOPIFY_TOKEN,
    'Content-Type': 'application/json'
  }
});

const data = await res.json();
console.log('Products:', data.products.map(p => p));
console.log('Products:', data.products.map(p => p.variants[0]));

const filename = 'products.json';

try {
  // Convert object to a formatted JSON string
  const jsonString = JSON.stringify(data.products, null, 2);

  // Write the file to disk
  writeFileSync(filename, jsonString);
  console.log(`Successfully wrote data to ${filename}`);
} catch (error) {
  console.error('Error writing file:', error);
}
