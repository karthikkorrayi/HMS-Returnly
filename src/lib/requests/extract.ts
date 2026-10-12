// Rule-based extraction of item details from a customer's own words.
// Deliberately simple and predictable: it only pre-fills fields the customer
// then confirms or edits. A future AI extractor can replace extractDetails()
// as long as it returns the same shape.

export type ExtractedDetails = {
  itemName: string | null
  category: string | null
  colour: string | null
  brand: string | null
  location: string | null
}

// First matching keyword decides the category; the keyword becomes the item name.
const CATEGORY_KEYWORDS: [string, string[]][] = [
  ['jewellery_watches', ['bracelet', 'necklace', 'ring', 'earring', 'earrings', 'watch', 'pendant', 'bangle', 'brooch', 'chain', 'anklet', 'jewellery', 'jewelry']],
  ['electronics', ['phone', 'iphone', 'smartphone', 'mobile', 'laptop', 'macbook', 'tablet', 'ipad', 'kindle', 'headphones', 'earphones', 'earbuds', 'airpods', 'camera', 'speaker', 'smartwatch', 'fitbit']],
  ['chargers_cables', ['charger', 'cable', 'adapter', 'adaptor', 'plug', 'powerbank', 'power bank']],
  ['documents_cards', ['passport', 'licence', 'license', 'card', 'id', 'document', 'documents', 'ticket', 'visa']],
  ['cash_wallets', ['wallet', 'purse', 'cash', 'money', 'cardholder']],
  ['bags', ['bag', 'backpack', 'rucksack', 'handbag', 'suitcase', 'case', 'holdall', 'tote', 'luggage']],
  ['shoes', ['shoes', 'shoe', 'trainers', 'sneakers', 'boots', 'sandals', 'slippers', 'heels']],
  ['clothing', ['jacket', 'coat', 'shirt', 'dress', 'jumper', 'sweater', 'hoodie', 'scarf', 'hat', 'cap', 'gloves', 'trousers', 'jeans', 'top', 'pyjamas', 'swimsuit', 'belt', 'tie']],
  ['toiletries', ['toiletries', 'razor', 'toothbrush', 'perfume', 'aftershave', 'makeup', 'hairdryer', 'straighteners']],
  ['medication', ['medication', 'medicine', 'tablets', 'pills', 'inhaler', 'insulin']],
  ['toys', ['toy', 'teddy', 'doll', 'lego']],
  ['books', ['book', 'notebook', 'diary', 'journal']],
]

const COLOURS = [
  'rose gold', 'navy blue', 'light blue', 'dark blue', 'dark green',
  'black', 'white', 'grey', 'gray', 'silver', 'gold', 'red', 'blue', 'navy', 'green', 'yellow',
  'orange', 'pink', 'purple', 'brown', 'beige', 'cream', 'tan', 'khaki', 'burgundy', 'teal',
]

const BRANDS = [
  'Apple', 'Samsung', 'Google', 'Sony', 'Bose', 'Beats', 'JBL', 'Anker', 'Amazon', 'Kindle', 'Dell', 'HP', 'Lenovo',
  'Microsoft', 'Huawei', 'OnePlus', 'Xiaomi', 'Fitbit', 'Garmin', 'Canon', 'Nikon', 'GoPro',
  'Pandora', 'Rolex', 'Omega', 'Casio', 'Seiko', 'Fossil', 'Swatch', 'Tissot', 'Swarovski', 'Tiffany', 'Cartier',
  'Michael Kors', 'Daniel Wellington', 'Ray-Ban', 'Oakley', 'Gucci', 'Prada', 'Chanel', 'Dior', 'Burberry',
  'Louis Vuitton', 'Mulberry', 'Kipling', 'Samsonite', 'Montblanc', 'Ted Baker', 'North Face', 'Patagonia',
  'Nike', 'Adidas', 'Puma', 'New Balance', 'Under Armour', 'Lululemon', 'Zara', 'Uniqlo', 'Dyson', 'GHD',
]

const LOCATIONS: [string, RegExp][] = [
  ['Bathroom', /\b(bathroom|shower|bath|en-?suite)\b/],
  ['Bedroom', /\b(bedside|bed|pillow|drawer|wardrobe|safe|desk)\b/],
  ['Restaurant', /\b(restaurant|breakfast|dining)\b/],
  ['Bar', /\b(bar|lounge)\b/],
  ['Lobby / reception', /\b(lobby|reception|front desk)\b/],
  ['Gym, pool or spa', /\b(gym|pool|spa|sauna|changing room)\b/],
  ['Meeting room', /\b(meeting|conference|function room)\b/],
  ['Car park', /\b(car park|parking|garage)\b/],
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function extractDetails(text: string): ExtractedDetails {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `

  let category: string | null = null
  let itemName: string | null = null
  let earliest = Infinity
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    for (const w of words) {
      const m = new RegExp(`[^a-z]${escape(w)}[^a-z]`).exec(t)
      // The keyword mentioned first is usually the item ("phone in a black case").
      if (m && m.index < earliest) {
        earliest = m.index
        category = cat
        itemName = capitalise(w)
      }
    }
  }

  const colour = COLOURS.find((c) => new RegExp(`[^a-z]${escape(c)}[^a-z]`).test(t)) ?? null
  const brand = BRANDS.find((b) => new RegExp(`[^a-z]${escape(b.toLowerCase())}[^a-z]`).test(t)) ?? null

  const room = /\broom\s*(?:no\.?|number)?\s*(\d{2,4})\b/.exec(t)
  const location = room ? `Room ${room[1]}` : (LOCATIONS.find(([, re]) => re.test(t))?.[0] ?? null)

  return {
    itemName,
    category,
    colour: colour ? capitalise(colour === 'gray' ? 'grey' : colour) : null,
    brand,
    location,
  }
}
