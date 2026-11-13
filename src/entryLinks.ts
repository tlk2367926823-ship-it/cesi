export type MerchantEntry = {
  merchantId: string;
  merchantName: string;
};

export type MerchantLinkSource = "nfc" | "quickNfc" | "qrcode" | "quickQrcode";

export function getMerchantActivityUrl(
  merchant: MerchantEntry,
  source: MerchantLinkSource = "nfc",
  origin = window.location.origin,
) {
  const url = new URL("/", origin);
  const isQrSource = source === "qrcode" || source === "quickQrcode";
  const withoutKeywords = source === "quickQrcode" || source === "quickNfc";

  url.searchParams.set("source", isQrSource ? "qrcode" : "nfc");
  url.searchParams.set("entry", isQrSource ? "qr" : "nfc");
  url.searchParams.set("keyword", withoutKeywords ? "off" : "on");
  url.searchParams.set("merchantId", merchant.merchantId);
  url.searchParams.set("merchantName", merchant.merchantName);
  return url.toString();
}
