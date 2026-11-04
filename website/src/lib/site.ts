export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://smallbirdai.com"
export const siteName = "SmallBird AI"

// Every way people type the brand. Used in structured data so Google ties
// all of them to this site rather than to other things called "smallbird".
export const brandAlternateNames = ["SmallBird", "Smallbird AI", "Small Bird AI", "Smallbird", "smallbirdai"]

// Official profiles elsewhere on the web (schema.org sameAs). Each one added
// here, with a link back to smallbirdai.com on the profile itself, makes the
// brand a stronger entity and gives the "smallbird" results page more
// SmallBird AI listings. Add the URL once the profile exists.
export const brandProfiles: string[] = [
  "https://github.com/aniruddhkadam7/SmallBird-releases",
]

// IndexNow (Bing, Yandex, Seznam, Naver): the key file served from public/
// proves we own the site so new or changed pages can be pushed for crawling.
export const indexNowKey = "106ddcf4c64e3955dc1ba2af97a8a129"
