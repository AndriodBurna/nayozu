import type { Metadata } from "next";
import ComingSoonClient from "./coming-soon-client";

export const metadata: Metadata = {
  title: "Coming Soon — Upcoming Anime Series & Movies | Nayozu",
  description:
    "Explore upcoming anime television series, ONAs, OVAs, and movies announced for future release on Nayozu.",
};

export default function ComingSoonPage() {
  return <ComingSoonClient />;
}
