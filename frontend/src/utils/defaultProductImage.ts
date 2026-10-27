import imageOne from "../assets/store-hero-01.webp";
import imageTwo from "../assets/store-hero-02.webp";
import imageThree from "../assets/store-hero-03.webp";

const DEFAULT_PRODUCT_IMAGES = [imageOne, imageTwo, imageThree];

// A product without a photo always gets the same one of three stand-ins, so it does not change
// between renders or pages. These are the images the home page already ships, so no extra bytes.
export function defaultProductImage(productId: number): string {
  return DEFAULT_PRODUCT_IMAGES[Math.abs(productId) % DEFAULT_PRODUCT_IMAGES.length];
}
