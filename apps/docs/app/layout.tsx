import "nextra-theme-docs/style.css";
import type { ReactNode } from "react";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Footer, Layout, Navbar } from "nextra-theme-docs";

export const metadata = {
  title: {
    default: "use-lane",
    template: "%s – use-lane",
  },
  description: "Transition-native data fetching for React 19.",
};

const navbar = (
  <Navbar
    logo={<b>use-lane</b>}
    projectLink="https://github.com/KentoMoriwaki/lane"
  />
);

const footer = (
  <Footer>
    MIT {new Date().getFullYear()} ©{" "}
    <a href="https://github.com/KentoMoriwaki/lane" target="_blank" rel="noreferrer">
      use-lane
    </a>
    .
  </Footer>
);

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/KentoMoriwaki/lane/tree/main/apps/docs"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
