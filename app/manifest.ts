import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "義學公務資訊站",
    short_name: "義學公務",
    description: "義學國中校務與公務資訊整合平台",
    start_url: "/ysjh-info/",
    scope: "/ysjh-info/",
    display: "standalone",
    theme_color: "#173B63",
    background_color: "#F3F5F7",
    icons: [
      {
        src: "/ysjh-info/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/ysjh-info/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/ysjh-info/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/ysjh-info/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
