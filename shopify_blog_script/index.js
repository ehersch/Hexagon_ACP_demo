// Standalone Node.js script to manage Shopify blogs and create an article via Admin REST API
const API_VERSION = '2024-01';
const BLOG_TITLE = 'Hexagon AI Blog';

// Define the article payload that will be created inside the target blog
const ARTICLE_DETAILS = {
  title: 'Introducing Hexagon AI',
  author: 'Hexagon Team',
  body_html: '<p>Meet the future of ecommerce automation with Hexagon AI.</p>',
  summary_html: '<p>Hexagon AI streamlines workflows for modern brands.</p>',
  tags: 'Hexagon,AI,Automation',
  published: true,
};

// Grab credentials from the environment and fail fast if they are missing
const { SHOPIFY_ADMIN_TOKEN, SHOPIFY_STORE_DOMAIN } = process.env;
if (!SHOPIFY_ADMIN_TOKEN || !SHOPIFY_STORE_DOMAIN) {
  console.error('Missing SHOPIFY_ADMIN_TOKEN or SHOPIFY_STORE_DOMAIN environment variables.');
  process.exit(1);
}

const BASE_URL = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}`;

/**
 * Helper for making Shopify API calls with common headers and consistent error reporting.
 */
async function shopifyFetch(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Fetch all blogs from Shopify and log their identifiers, titles, and handles.
 */
async function fetchAndLogBlogs() {
  console.log('Fetching blogs...');
  const data = await shopifyFetch('/blogs.json', { method: 'GET' });
  const blogs = data.blogs || [];

  if (blogs.length === 0) {
    console.log('No blogs found.');
  } else {
    blogs.forEach((blog) => {
      console.log(`Blog ID: ${blog.id}, Title: ${blog.title}, Handle: ${blog.handle}`);
    });
  }

  return blogs;
}

/**
 * Ensure a blog with the required title exists, creating it if necessary.
 */
async function ensureHexagonBlog(blogs) {
  const existing = blogs.find((blog) => blog.title === BLOG_TITLE);
  if (existing) {
    console.log(`Found existing blog "${BLOG_TITLE}" with ID ${existing.id}.`);
    return existing.id;
  }

  console.log(`Blog "${BLOG_TITLE}" not found. Creating it...`);
  const payload = { blog: { title: BLOG_TITLE } };
  const data = await shopifyFetch('/blogs.json', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const newBlog = data.blog;
  if (!newBlog || !newBlog.id) {
    throw new Error('Failed to create the Hexagon AI Blog. No blog ID returned.');
  }

  console.log(`Created blog "${BLOG_TITLE}" with ID ${newBlog.id}.`);
  return newBlog.id;
}

/**
 * Create a single article within the specified blog.
 */
async function createArticle(blogId) {
  console.log(`Creating article in blog ${blogId}...`);
  const payload = { article: ARTICLE_DETAILS };
  const data = await shopifyFetch(`/blogs/${blogId}/articles.json`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const article = data.article;
  console.log(`Created article ID ${article?.id} titled "${article?.title}".`);
}

async function main() {
  try {
    const blogs = await fetchAndLogBlogs();

    // If invoked with `node index.js list`, only display existing blogs.
    if (process.argv[2] === 'list') {
      console.log(`Total blogs: ${blogs.length}`);
      return;
    }

    const blogId = await ensureHexagonBlog(blogs);
    await createArticle(blogId);
    console.log('Script completed successfully.');
  } catch (error) {
    console.error('Error running Shopify blog script:', error.message);
    process.exitCode = 1;
  }
}

main();
