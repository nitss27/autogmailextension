(() => {
  'use strict';

  const select = (selector, scope = document) => scope.querySelector(selector);
  const selectAll = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const cartDrawer = select('[data-cart-drawer]');
  const overlay = select('[data-drawer-overlay]');

  function openCartDrawer() {
    if (!cartDrawer || !overlay) return;
    cartDrawer.classList.add('is-open');
    cartDrawer.setAttribute('aria-hidden', 'false');
    overlay.hidden = false;
  }

  function closeCartDrawer() {
    if (!cartDrawer || !overlay) return;
    cartDrawer.classList.remove('is-open');
    cartDrawer.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;
  }

  async function refreshCartDrawer(url) {
    const response = await fetch(url);
    if (!response.ok) return;
    const container = document.createElement('div');
    container.innerHTML = await response.text();
    const replacement = select('[data-cart-drawer]', container);
    if (replacement && cartDrawer) cartDrawer.innerHTML = replacement.innerHTML;
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.cart-toggle')) openCartDrawer();
    if (event.target.closest('[data-cart-close]') || event.target === overlay) closeCartDrawer();

    const menuButton = event.target.closest('[data-menu-toggle]');
    if (menuButton) {
      const menu = select('#MobileMenu');
      menu.hidden = !menu.hidden;
      menuButton.setAttribute('aria-expanded', String(!menu.hidden));
    }

    if (event.target.closest('[data-search-toggle]')) {
      const drawer = select('[data-search-drawer]');
      drawer.hidden = !drawer.hidden;
      if (!drawer.hidden) select('input', drawer).focus();
    }

    const announcementClose = event.target.closest('.announcement__close');
    if (announcementClose) announcementClose.closest('[data-announcement]')?.remove();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCartDrawer();
  });

  let searchTimer;
  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-predictive-search]');
    if (!input) return;
    const results = select('[data-search-results]');
    const endpoint = select('.site-header')?.dataset.predictiveUrl;
    clearTimeout(searchTimer);
    if (input.value.trim().length < 2) {
      results.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(async () => {
      const params = new URLSearchParams({q: input.value.trim(), 'resources[type]': 'product', 'resources[limit]': '4', section_id: 'predictive-search'});
      const response = await fetch(`${endpoint}?${params}`);
      results.innerHTML = response.ok ? await response.text() : '';
    }, 200);
  });

  selectAll('[data-product]').forEach((productRoot) => {
    const product = JSON.parse(select('[data-product-json]', productRoot).textContent);
    const form = select('[data-product-form]', productRoot);
    const variantIdInput = select('[data-variant-id]', productRoot);
    const price = select('[data-price]', productRoot);
    const addButton = select('[data-add-button]', productRoot);
    const error = select('[data-product-error]', productRoot);
    let selectedOptions = product.options.map((_, index) => select(`[data-option-position="${index + 1}"].is-selected`, productRoot)?.dataset.optionValue || '');

    const money = (cents) => new Intl.NumberFormat(document.documentElement.lang || 'en', {
      style: 'currency', currency: window.Shopify?.currency?.active || 'INR'
    }).format(cents / 100);

    function updateVariant() {
      const variant = product.variants.find((item) => item.options.every((option, index) => option === selectedOptions[index]));
      if (!variant) return;
      variantIdInput.value = variant.id;
      addButton.disabled = !variant.available;
      addButton.textContent = variant.available ? productRoot.dataset.addText : productRoot.dataset.soldOutText;
      const sale = variant.compare_at_price > variant.price;
      price.innerHTML = `${sale ? `<s>${money(variant.compare_at_price)}</s>` : ''}<strong class="${sale ? 'price--sale' : ''}">${money(variant.price)}</strong>${sale ? `<span class="price__save">Save ${money(variant.compare_at_price - variant.price)}</span>` : ''}`;
      const stock = select('[data-stock-status]', productRoot);
      if (stock) stock.innerHTML = `<span class="stock-dot${variant.available ? ' stock-dot--in' : ''}"></span>${variant.available ? productRoot.dataset.inStockText : productRoot.dataset.outStockText}`;
      if (variant.featured_image) select('[data-gallery-main]', productRoot).innerHTML = `<img src="${variant.featured_image.src}" alt="${variant.featured_image.alt || product.title}">`;
    }

    productRoot.addEventListener('click', (event) => {
      const option = event.target.closest('[data-option-position]');
      if (option) {
        const position = Number(option.dataset.optionPosition);
        selectedOptions[position - 1] = option.dataset.optionValue;
        selectAll(`[data-option-position="${position}"]`, productRoot).forEach((button) => {
          const active = button === option;
          button.classList.toggle('is-selected', active);
          button.setAttribute('aria-pressed', String(active));
        });
        updateVariant();
      }

      const quantityButton = event.target.closest('[data-quantity-minus], [data-quantity-plus]');
      if (quantityButton) {
        const input = select('input[name="quantity"]', productRoot);
        const delta = quantityButton.matches('[data-quantity-plus]') ? 1 : -1;
        const maximum = Number(input.max) || 999;
        input.value = Math.max(Number(input.min) || 1, Math.min(maximum, Number(input.value) + delta));
      }

      const thumbnail = event.target.closest('[data-media-id]');
      if (thumbnail) {
        selectAll('.gallery-thumb', productRoot).forEach((button) => button.classList.toggle('is-active', button === thumbnail));
        const image = select('img', thumbnail);
        select('[data-gallery-main]', productRoot).innerHTML = `<img src="${image.src}" alt="${image.alt}">`;
      }
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      addButton.disabled = true;
      error.hidden = true;
      try {
        const response = await fetch(productRoot.dataset.cartAddUrl, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({id: variantIdInput.value, quantity: Number(select('input[name="quantity"]', form).value)})});
        if (!response.ok) throw new Error((await response.json()).description);
        const cart = await (await fetch(productRoot.dataset.cartUrl)).json();
        selectAll('[data-cart-count]').forEach((count) => { count.textContent = cart.item_count; });
        await refreshCartDrawer(productRoot.dataset.cartDrawerUrl);
        openCartDrawer();
      } catch (exception) {
        error.textContent = exception.message || productRoot.dataset.addErrorText;
        error.hidden = false;
      } finally {
        updateVariant();
      }
    });
  });

  selectAll('[data-recommendations]').forEach(async (section) => {
    const response = await fetch(section.dataset.url);
    if (response.ok) section.innerHTML = await response.text();
  });
})();
