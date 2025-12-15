import argparse
import requests
import json
import time

parser = argparse.ArgumentParser(description="Download catalog via Shopify MCP.")
parser.add_argument(
    "--store",
    default="skims.com",
    help="Store domain (e.g. hexagon.com, www.example.com)",
)
parser.add_argument(
    "--max-products",
    type=int,
    default=300,
    help="Maximum products to fetch (default 300, set to 0 for unlimited)",
)
parser.add_argument(
    "--output",
    default=None,
    help="Output file path (default <store>_catalog.json).",
)

args = parser.parse_args()
STORE = args.store
MAX_PRODUCTS = None if args.max_products == 0 else args.max_products

STORE_NAME = (
    STORE.replace("www.", "")
    .replace(".com", "")
    .replace(".co", "")
    .replace(".br", "")
    .replace(".", "_")
)
OUTPUT_FILE = args.output or f"{STORE_NAME}_catalog.json"

URL = f"https://{STORE}/api/mcp"


def call(method, params=None):
    try:
        r = requests.post(
            URL,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=60,
        )
        if r.status_code != 200:
            print(f"HTTP {r.status_code}: {r.text[:200]}")
            return None
        if not r.text.strip():
            print("Empty response - MCP not enabled")
            return None
        return r.json()
    except Exception as e:
        print(f"Error: {e}")
        return None


print(f"Connecting to {STORE}...")
result = call(
    "initialize",
    {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "dl", "version": "1.0"},
    },
)

if not result:
    print(f"\n❌ {STORE} does not support Shopify MCP")
    exit(1)

if MAX_PRODUCTS:
    print(f"Connected! (max {MAX_PRODUCTS} products)\n")
else:
    print(f"Connected! (no limit)\n")

all_products = []
cursor = None
page = 1

while True:
    if MAX_PRODUCTS and len(all_products) >= MAX_PRODUCTS:
        break

    print(f"Page {page}...", end=" ", flush=True)

    args = {"query": "*", "context": "catalog", "limit": 100}
    if cursor:
        args["after"] = cursor

    result = call("tools/call", {"name": "search_shop_catalog", "arguments": args})
    if not result:
        break

    content = result.get("result", {}).get("content", [])
    if not content:
        break

    text_content = content[0].get("text", "{}") if content else "{}"
    data = json.loads(text_content)

    products = data.get("products", [])
    print(f"{len(products)} products")
    all_products.extend(products)

    pagination = data.get("pagination", {})
    cursor = pagination.get("endCursor")
    has_next = pagination.get("hasNextPage", False)

    if not has_next or not cursor or len(products) == 0:
        break

    page += 1
    time.sleep(0.3)

if MAX_PRODUCTS:
    all_products = all_products[:MAX_PRODUCTS]

print(f"\n✅ Total: {len(all_products)} products")

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(all_products, f, indent=2)

print(f"Saved to {OUTPUT_FILE}")
