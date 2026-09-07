# Luxinom Theme

An MIT-licensed Shopify Online Store 2.0 theme with an editorial storefront, responsive product gallery, native predictive search, AJAX cart drawer, variant selection, and product recommendations.

## Install

1. Install the [Shopify CLI](https://shopify.dev/docs/themes/tools/cli).
2. From this directory, authenticate with `shopify auth login`.
3. Preview locally with `shopify theme dev --store your-store.myshopify.com`.
4. Upload with `shopify theme push --store your-store.myshopify.com`.

## Customize

Open **Online Store → Themes → Customize**. The Header and Footer are section groups; homepage sections can be reordered, added, and configured in the editor. Global colors, fonts, address, and contact email live in **Theme settings**. Assign menus to the Header and Footer, select a featured collection, and use each image picker to supply optimized imagery.

## Structure

- `layout/` contains the base document shell.
- `templates/` contains JSON templates for storefront routes.
- `sections/` contains all editor-configurable modules.
- `snippets/` contains reusable price, product card, and cart UI fragments.
- `assets/` contains framework-free responsive CSS and native Shopify Ajax JavaScript.

## License

Released under the [MIT License](LICENSE).
