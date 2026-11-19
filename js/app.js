/**
 * 育達樂活能量飲 (YUDA LOHAS Energy) 前端互動邏輯
 * 遵循 AGENTS.md：
 * - 原生 JavaScript、無外部依賴、不使用後端或金鑰
 * - 商品文字一律使用 textContent 填入，防止 XSS
 * - 支援手機選單開關、分類+即時搜尋雙重篩選、Esc/點背景關閉彈窗
 * - 支援時區固定截止倒數計時與優惠碼複製回饋
 * - localStorage 僅保存商品 ID 與數量，支援複製明細與下載 .txt
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'yuda_lohas_preorder_v1';

  // 應用程式狀態
  const state = {
    activeCategory: '全部',
    searchQuery: '',
    cart: [], // 格式：[{ id: 'yuda-01', qty: 2 }]
    appliedCoupon: '',
    isPromoExpired: false,
    activeModalProductId: null,
    lastFocusedElement: null
  };

  // DOM 參照
  const dom = {
    // 導覽選單
    menuToggle: document.getElementById('menu-toggle'),
    primaryNav: document.getElementById('primary-nav'),
    navCartCount: document.getElementById('nav-cart-count'),

    // 限時優惠橫幅
    promoBanner: document.getElementById('promo-banner'),
    promoBadge: document.getElementById('promo-badge'),
    promoTitle: document.getElementById('promo-title'),
    promoCountdown: document.getElementById('promo-countdown'),
    cdDays: document.getElementById('cd-days'),
    cdHours: document.getElementById('cd-hours'),
    cdMinutes: document.getElementById('cd-minutes'),
    cdSeconds: document.getElementById('cd-seconds'),
    promoCodeText: document.getElementById('promo-code-text'),
    copyPromoBtn: document.getElementById('copy-promo-btn'),
    promoFeedback: document.getElementById('promo-feedback'),

    // 商品型錄與篩選
    searchInput: document.getElementById('product-search'),
    clearSearchBtn: document.getElementById('clear-search-btn'),
    categoryButtons: document.getElementById('category-buttons'),
    catalogResultInfo: document.getElementById('catalog-result-info'),
    productGrid: document.getElementById('product-grid'),
    emptySearchState: document.getElementById('empty-search-state'),
    resetFilterBtn: document.getElementById('reset-filter-btn'),

    // 評價與 FAQ
    reviewsGrid: document.getElementById('reviews-grid'),
    faqList: document.getElementById('faq-list'),

    // 彈窗 Modal
    modalOverlay: document.getElementById('product-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalSecondaryCloseBtn: document.getElementById('modal-secondary-close-btn'),
    modalImg: document.getElementById('modal-product-img'),
    modalCategory: document.getElementById('modal-product-category'),
    modalTitle: document.getElementById('modal-product-title'),
    modalSpec: document.getElementById('modal-product-spec'),
    modalPrice: document.getElementById('modal-product-price'),
    modalShort: document.getElementById('modal-product-short'),
    modalFull: document.getElementById('modal-product-full'),
    modalAddCartBtn: document.getElementById('modal-add-cart-btn'),

    // 預購清單與表單
    clearCartBtn: document.getElementById('clear-cart-btn'),
    cartEmptyMsg: document.getElementById('cart-empty-msg'),
    cartItemsList: document.getElementById('cart-items-list'),
    couponInput: document.getElementById('coupon-input'),
    applyCouponBtn: document.getElementById('apply-coupon-btn'),
    couponStatusMsg: document.getElementById('coupon-status-msg'),
    summaryTotalQty: document.getElementById('summary-total-qty'),
    summarySubtotal: document.getElementById('summary-subtotal'),
    summaryDiscountLabel: document.getElementById('summary-discount-label'),
    summaryDiscountAmount: document.getElementById('summary-discount-amount'),
    summaryFinalTotal: document.getElementById('summary-final-total'),
    nicknameInput: document.getElementById('customer-nickname'),
    noteInput: document.getElementById('customer-note'),
    preorderAlert: document.getElementById('preorder-alert'),
    orderSummaryPreview: document.getElementById('order-summary-preview'),
    copySummaryBtn: document.getElementById('copy-summary-btn'),
    downloadTxtBtn: document.getElementById('download-txt-btn'),
    exportFeedback: document.getElementById('export-feedback')
  };

  /* ========================================================================
     1. 手機版導覽選單開關
     ======================================================================== */
  function setMobileMenuOpen(isOpen) {
    dom.primaryNav.classList.toggle('is-open', isOpen);
    dom.menuToggle.setAttribute('aria-expanded', String(isOpen));
    dom.menuToggle.setAttribute('aria-label', isOpen ? '關閉選單' : '展開選單');
    const labelSpan = dom.menuToggle.querySelector('.menu-toggle-text');
    if (labelSpan) {
      labelSpan.textContent = isOpen ? '關閉' : '選單';
    }
  }

  function initMobileMenu() {
    dom.menuToggle.addEventListener('click', function () {
      const expanded = dom.menuToggle.getAttribute('aria-expanded') === 'true';
      setMobileMenuOpen(!expanded);
    });

    // 點擊任一導覽連結後自動收合手機選單
    dom.primaryNav.addEventListener('click', function (event) {
      if (event.target.closest('.nav-link')) {
        setMobileMenuOpen(false);
      }
    });
  }

  /* ========================================================================
     2. 限時活動倒數橫幅與優惠碼複製（支援 ?promo=expired 驗收測試）
     ======================================================================== */
  function getEffectiveDeadline() {
    const params = new URLSearchParams(window.location.search);
    const promoOverride = params.get('promo');
    if (promoOverride === 'expired') {
      // 提供驗收已過期狀態的快速參數
      return new Date('2020-01-01T00:00:00+08:00');
    }
    return new Date(PROMO_CONFIG.deadline);
  }

  function padTwoDigits(num) {
    return String(Math.max(0, num)).padStart(2, '0');
  }

  let countdownTimerId = null;

  function updateCountdown() {
    const deadlineDate = getEffectiveDeadline();
    const now = new Date();
    const diffMs = deadlineDate.getTime() - now.getTime();

    if (diffMs <= 0 || Number.isNaN(diffMs)) {
      const wasExpired = state.isPromoExpired;
      state.isPromoExpired = true;

      dom.cdDays.textContent = '00';
      dom.cdHours.textContent = '00';
      dom.cdMinutes.textContent = '00';
      dom.cdSeconds.textContent = '00';

      dom.promoBanner.classList.add('is-expired');
      dom.promoBadge.textContent = '活動已結束';
      dom.promoTitle.textContent = PROMO_CONFIG.expiredMessage;
      dom.copyPromoBtn.disabled = true;
      dom.copyPromoBtn.textContent = '優惠已截止';

      if (!wasExpired) {
        renderCartAndSummary();
      }
      if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
      }
      return;
    }

    state.isPromoExpired = false;
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    dom.cdDays.textContent = padTwoDigits(days);
    dom.cdHours.textContent = padTwoDigits(hours);
    dom.cdMinutes.textContent = padTwoDigits(minutes);
    dom.cdSeconds.textContent = padTwoDigits(seconds);
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        const tempArea = document.createElement('textarea');
        tempArea.value = text;
        tempArea.setAttribute('readonly', '');
        tempArea.style.position = 'fixed';
        tempArea.style.opacity = '0';
        document.body.appendChild(tempArea);
        tempArea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(tempArea);
        if (ok) resolve();
        else reject(new Error('Copy command failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function initPromoBanner() {
    dom.promoTitle.textContent = PROMO_CONFIG.title;
    dom.promoCodeText.textContent = PROMO_CONFIG.code;

    updateCountdown();
    if (!state.isPromoExpired) {
      countdownTimerId = window.setInterval(updateCountdown, 1000);
    }

    dom.copyPromoBtn.addEventListener('click', function () {
      if (state.isPromoExpired) return;
      copyTextToClipboard(PROMO_CONFIG.code)
        .then(function () {
          state.appliedCoupon = PROMO_CONFIG.code;
          dom.couponInput.value = PROMO_CONFIG.code;
          dom.promoFeedback.textContent = '✓ 已複製優惠碼 ' + PROMO_CONFIG.code + '，並同步帶入下方預購清單！';
          dom.copyPromoBtn.textContent = '已複製！';
          renderCartAndSummary();

          window.setTimeout(function () {
            if (!state.isPromoExpired) {
              dom.copyPromoBtn.textContent = '複製優惠碼';
            }
          }, 2200);
        })
        .catch(function () {
          dom.promoFeedback.textContent = '請手動複製優惠碼：' + PROMO_CONFIG.code;
        });
    });
  }

  /* ========================================================================
     3. 商品分類篩選、即時搜尋與商品詳情彈窗（嚴格使用 textContent）
     ======================================================================== */
  function getCategories() {
    const set = new Set(['全部']);
    PRODUCTS.forEach(function (item) {
      set.add(item.category);
    });
    return Array.from(set);
  }

  function renderCategoryButtons() {
    dom.categoryButtons.textContent = '';
    const categories = getCategories();

    categories.forEach(function (cat) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-btn' + (state.activeCategory === cat ? ' is-active' : '');
      btn.setAttribute('aria-pressed', String(state.activeCategory === cat));
      btn.textContent = cat;

      btn.addEventListener('click', function () {
        state.activeCategory = cat;
        renderCategoryButtons();
        renderProducts();
      });

      dom.categoryButtons.appendChild(btn);
    });
  }

  function getFilteredProducts() {
    const keyword = state.searchQuery.trim().toLowerCase();

    return PRODUCTS.filter(function (product) {
      const matchCategory =
        state.activeCategory === '全部' || product.category === state.activeCategory;

      if (!matchCategory) return false;
      if (!keyword) return true;

      const haystack = [
        product.name,
        product.category,
        product.shortDesc,
        product.fullDesc,
        product.spec
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }

  function createProductCard(product) {
    const article = document.createElement('article');
    article.className = 'product-card';

    const imgBox = document.createElement('div');
    imgBox.className = 'product-img-box';

    const img = document.createElement('img');
    img.className = 'product-img';
    img.src = product.image;
    img.alt = product.imageAlt;
    img.loading = 'lazy';
    img.width = 640;
    img.height = 480;
    imgBox.appendChild(img);

    const body = document.createElement('div');
    body.className = 'product-body';

    const metaTop = document.createElement('div');
    metaTop.className = 'product-meta-top';

    const badge = document.createElement('span');
    badge.className = 'product-cat-badge';
    badge.textContent = product.category;

    const price = document.createElement('span');
    price.className = 'product-price';
    price.textContent = 'NT$ ' + product.price;

    metaTop.appendChild(badge);
    metaTop.appendChild(price);

    const title = document.createElement('h3');
    title.className = 'product-name';
    title.textContent = product.name;

    const spec = document.createElement('p');
    spec.className = 'product-spec';
    spec.textContent = product.spec;

    const shortDesc = document.createElement('p');
    shortDesc.className = 'product-short-desc';
    shortDesc.textContent = product.shortDesc;

    const actions = document.createElement('div');
    actions.className = 'product-card-actions';

    const detailBtn = document.createElement('button');
    detailBtn.type = 'button';
    detailBtn.className = 'btn btn-secondary btn-sm';
    detailBtn.textContent = '查看詳情';
    detailBtn.addEventListener('click', function () {
      openProductModal(product.id, detailBtn);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.textContent = '＋ 加入預購';
    addBtn.addEventListener('click', function () {
      addToCart(product.id, 1);
      const originalLabel = '＋ 加入預購';
      addBtn.textContent = '✓ 已加入';
      window.setTimeout(function () {
        addBtn.textContent = originalLabel;
      }, 1000);
    });

    actions.appendChild(detailBtn);
    actions.appendChild(addBtn);

    body.appendChild(metaTop);
    body.appendChild(title);
    body.appendChild(spec);
    body.appendChild(shortDesc);
    body.appendChild(actions);

    article.appendChild(imgBox);
    article.appendChild(body);

    return article;
  }

  function renderProducts() {
    const filtered = getFilteredProducts();
    dom.productGrid.textContent = '';

    dom.clearSearchBtn.hidden = state.searchQuery.length === 0;

    if (filtered.length === 0) {
      dom.productGrid.hidden = true;
      dom.emptySearchState.hidden = false;
      dom.catalogResultInfo.textContent = '目前符合條件的商品：0 款';
      return;
    }

    dom.productGrid.hidden = false;
    dom.emptySearchState.hidden = true;

    let statusText = '共顯示 ' + filtered.length + ' 款能量飲';
    if (state.activeCategory !== '全部') {
      statusText += '（分類：' + state.activeCategory + '）';
    }
    if (state.searchQuery.trim() !== '') {
      statusText += '（搜尋：「' + state.searchQuery.trim() + '」）';
    }
    dom.catalogResultInfo.textContent = statusText;

    const fragment = document.createDocumentFragment();
    filtered.forEach(function (product) {
      fragment.appendChild(createProductCard(product));
    });
    dom.productGrid.appendChild(fragment);
  }

  function openProductModal(productId, triggerEl) {
    const product = PRODUCTS.find(function (item) {
      return item.id === productId;
    });
    if (!product) return;

    state.activeModalProductId = product.id;
    state.lastFocusedElement = triggerEl || document.activeElement;

    // 嚴格使用 textContent 填入商品文字
    dom.modalImg.src = product.image;
    dom.modalImg.alt = product.imageAlt;
    dom.modalCategory.textContent = product.category;
    dom.modalTitle.textContent = product.name;
    dom.modalSpec.textContent = product.spec;
    dom.modalPrice.textContent = 'NT$ ' + product.price + '／罐';
    dom.modalShort.textContent = product.shortDesc;
    dom.modalFull.textContent = product.fullDesc;
    dom.modalAddCartBtn.textContent = '＋ 加入預購清單';

    dom.modalOverlay.hidden = false;
    document.body.classList.add('modal-open');
    dom.modalCloseBtn.focus();
  }

  function closeProductModal() {
    if (dom.modalOverlay.hidden) return;
    dom.modalOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    state.activeModalProductId = null;

    if (state.lastFocusedElement && typeof state.lastFocusedElement.focus === 'function') {
      state.lastFocusedElement.focus();
    }
  }

  function initCatalogAndModal() {
    renderCategoryButtons();
    renderProducts();

    dom.searchInput.addEventListener('input', function (event) {
      state.searchQuery = event.target.value;
      renderProducts();
    });

    dom.clearSearchBtn.addEventListener('click', function () {
      state.searchQuery = '';
      dom.searchInput.value = '';
      renderProducts();
      dom.searchInput.focus();
    });

    dom.resetFilterBtn.addEventListener('click', function () {
      state.activeCategory = '全部';
      state.searchQuery = '';
      dom.searchInput.value = '';
      renderCategoryButtons();
      renderProducts();
      dom.searchInput.focus();
    });

    dom.modalCloseBtn.addEventListener('click', closeProductModal);
    dom.modalSecondaryCloseBtn.addEventListener('click', closeProductModal);

    // 點擊彈窗背景遮罩關閉
    dom.modalOverlay.addEventListener('click', function (event) {
      if (event.target === dom.modalOverlay) {
        closeProductModal();
      }
    });

    dom.modalAddCartBtn.addEventListener('click', function () {
      if (!state.activeModalProductId) return;
      addToCart(state.activeModalProductId, 1);
      dom.modalAddCartBtn.textContent = '✓ 已加入預購清單！';
    });

    // 全域鍵盤 Esc 關閉彈窗或手機版選單
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (!dom.modalOverlay.hidden) {
          closeProductModal();
        } else if (dom.primaryNav.classList.contains('is-open')) {
          setMobileMenuOpen(false);
          dom.menuToggle.focus();
        }
      }
    });
  }

  /* ========================================================================
     4. 顧客評價與四個常見問題 FAQ（從 js/data.js 讀取，支援鍵盤展開）
     ======================================================================== */
  function renderReviews() {
    dom.reviewsGrid.textContent = '';
    const fragment = document.createDocumentFragment();

    REVIEWS.forEach(function (rev) {
      const card = document.createElement('article');
      card.className = 'review-card';

      const top = document.createElement('div');
      top.className = 'review-top';

      const stars = document.createElement('span');
      stars.className = 'review-stars';
      stars.setAttribute('aria-label', '五顆星推薦');
      stars.textContent = rev.rating;

      const tag = document.createElement('span');
      tag.className = 'review-tag';
      tag.textContent = rev.tag;

      top.appendChild(stars);
      top.appendChild(tag);

      const comment = document.createElement('p');
      comment.className = 'review-comment';
      comment.textContent = '「' + rev.comment + '」';

      const footer = document.createElement('div');
      footer.className = 'review-footer';

      const author = document.createElement('span');
      author.className = 'review-author';
      author.textContent = rev.author;

      const fav = document.createElement('span');
      fav.textContent = '私心推薦：' + rev.favorite;

      footer.appendChild(author);
      footer.appendChild(fav);

      card.appendChild(top);
      card.appendChild(comment);
      card.appendChild(footer);
      fragment.appendChild(card);
    });

    dom.reviewsGrid.appendChild(fragment);
  }

  function renderFaqs() {
    dom.faqList.textContent = '';
    const fragment = document.createDocumentFragment();

    FAQS.forEach(function (faq, index) {
      const item = document.createElement('div');
      item.className = 'faq-item';

      const panelId = 'faq-answer-' + faq.id;
      const btnId = 'faq-btn-' + faq.id;
      const isFirst = index === 0;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = btnId;
      btn.className = 'faq-question-btn';
      btn.setAttribute('aria-expanded', String(isFirst));
      btn.setAttribute('aria-controls', panelId);

      const qText = document.createElement('span');
      qText.textContent = faq.question;

      const icon = document.createElement('span');
      icon.className = 'faq-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '+';

      btn.appendChild(qText);
      btn.appendChild(icon);

      const answerWrap = document.createElement('div');
      answerWrap.id = panelId;
      answerWrap.className = 'faq-answer';
      answerWrap.setAttribute('role', 'region');
      answerWrap.setAttribute('aria-labelledby', btnId);
      answerWrap.hidden = !isFirst;

      const answerP = document.createElement('p');
      answerP.textContent = faq.answer;
      answerWrap.appendChild(answerP);

      btn.addEventListener('click', function () {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        answerWrap.hidden = expanded;
      });

      item.appendChild(btn);
      item.appendChild(answerWrap);
      fragment.appendChild(item);
    });

    dom.faqList.appendChild(fragment);
  }

  /* ========================================================================
     5. 預購清單 (localStorage 僅存商品 ID 與數量) 與明細匯出 (.txt / 複製)
     ======================================================================== */
  function loadCartFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      // 驗證僅保留合法商品 ID 與正整數數量
      const validIds = new Set(PRODUCTS.map(function (p) { return p.id; }));
      return parsed
        .filter(function (entry) {
          return (
            entry &&
            typeof entry.id === 'string' &&
            validIds.has(entry.id) &&
            Number.isInteger(entry.qty) &&
            entry.qty > 0
          );
        })
        .map(function (entry) {
          return { id: entry.id, qty: Math.min(entry.qty, 999) };
        });
    } catch (e) {
      return [];
    }
  }

  function saveCartToStorage() {
    try {
      const minimalData = state.cart.map(function (entry) {
        return { id: entry.id, qty: entry.qty };
      });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(minimalData));
    } catch (e) {
      // 忽略無痕模式或容量受限錯誤
    }
  }

  function addToCart(productId, deltaQty) {
    const existing = state.cart.find(function (item) {
      return item.id === productId;
    });

    if (existing) {
      existing.qty = Math.min(999, existing.qty + deltaQty);
    } else if (deltaQty > 0) {
      state.cart.push({ id: productId, qty: deltaQty });
    }

    hideValidationAlert();
    saveCartToStorage();
    renderCartAndSummary();
  }

  function updateCartQty(productId, newQty) {
    if (newQty <= 0) {
      removeFromCart(productId);
      return;
    }
    const existing = state.cart.find(function (item) {
      return item.id === productId;
    });
    if (existing) {
      existing.qty = Math.min(999, newQty);
      saveCartToStorage();
      renderCartAndSummary();
    }
  }

  function removeFromCart(productId) {
    state.cart = state.cart.filter(function (item) {
      return item.id !== productId;
    });
    saveCartToStorage();
    renderCartAndSummary();
  }

  function calculateTotals() {
    let totalQty = 0;
    let subtotal = 0;
    const detailedItems = [];

    state.cart.forEach(function (entry) {
      const product = PRODUCTS.find(function (p) {
        return p.id === entry.id;
      });
      if (!product) return;

      const lineTotal = product.price * entry.qty;
      totalQty += entry.qty;
      subtotal += lineTotal;
      detailedItems.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: entry.qty,
        lineTotal: lineTotal
      });
    });

    const isCouponValid =
      state.appliedCoupon.toUpperCase() === PROMO_CONFIG.code && !state.isPromoExpired;

    const finalTotal = isCouponValid
      ? Math.round(subtotal * PROMO_CONFIG.discountRate)
      : subtotal;
    const discountAmount = subtotal - finalTotal;

    return {
      detailedItems: detailedItems,
      totalQty: totalQty,
      subtotal: subtotal,
      isCouponValid: isCouponValid,
      discountAmount: discountAmount,
      finalTotal: finalTotal
    };
  }

  function buildOrderSummaryText(totals) {
    const nickname = dom.nicknameInput.value.trim() || '（尚未填寫聯絡人暱稱）';
    const note = dom.noteInput.value.trim() || '無';

    const lines = [
      '==============================',
      '⚡ 育達樂活能量飲｜線上預購明細',
      '==============================',
      '聯絡人暱稱：' + nickname,
      '建立時間：' + new Date().toLocaleString('zh-TW', { hour12: false }),
      '------------------------------',
      '【預購品項】'
    ];

    if (totals.detailedItems.length === 0) {
      lines.push('（尚未加入任何商品）');
    } else {
      totals.detailedItems.forEach(function (item, idx) {
        lines.push(
          (idx + 1) + '. ' + item.name + ' × ' + item.qty + ' 罐（單價 NT$ ' + item.price + '｜小計 NT$ ' + item.lineTotal + '）'
        );
      });
    }

    lines.push('------------------------------');
    lines.push('商品總數量：' + totals.totalQty + ' 罐');
    lines.push('原始小計：NT$ ' + totals.subtotal);

    if (totals.isCouponValid) {
      lines.push('使用優惠碼：' + PROMO_CONFIG.code + '（' + PROMO_CONFIG.discountLabel + '，折抵 -NT$ ' + totals.discountAmount + '）');
    } else if (state.appliedCoupon && state.isPromoExpired) {
      lines.push('使用優惠碼：無（原輸入 ' + state.appliedCoupon + ' 活動已截止）');
    } else {
      lines.push('使用優惠碼：無');
    }

    lines.push('優惠後應付總額：NT$ ' + totals.finalTotal);
    lines.push('取貨／備註：' + note);
    lines.push('==============================');
    lines.push('請將本明細貼至官方 LINE (@yudalohas-demo 示例) 或 IG (@yuda.lohas.demo 示例) 完成預購登記！');

    return lines.join('\n');
  }

  function renderCartAndSummary() {
    const totals = calculateTotals();

    dom.navCartCount.textContent = String(totals.totalQty);
    dom.summaryTotalQty.textContent = totals.totalQty + ' 罐';
    dom.summarySubtotal.textContent = 'NT$ ' + totals.subtotal;

    if (totals.isCouponValid) {
      dom.summaryDiscountLabel.textContent = '優惠碼 ' + PROMO_CONFIG.code + '（88 折）';
      dom.summaryDiscountAmount.textContent = '- NT$ ' + totals.discountAmount;
      dom.couponStatusMsg.classList.remove('is-error');
      dom.couponStatusMsg.textContent = '✓ 已套用 ' + PROMO_CONFIG.code + '（' + PROMO_CONFIG.discountLabel + '）';
    } else if (state.appliedCoupon) {
      dom.summaryDiscountLabel.textContent = '限時優惠折抵';
      dom.summaryDiscountAmount.textContent = '- NT$ 0';
      dom.couponStatusMsg.classList.add('is-error');
      dom.couponStatusMsg.textContent = state.isPromoExpired
        ? '此限時優惠活動已結束，將以原價計算。'
        : '查無此優惠碼，試試輸入 ' + PROMO_CONFIG.code + '！';
    } else {
      dom.summaryDiscountLabel.textContent = '限時優惠折抵';
      dom.summaryDiscountAmount.textContent = '- NT$ 0';
      dom.couponStatusMsg.textContent = '';
    }

    dom.summaryFinalTotal.textContent = 'NT$ ' + totals.finalTotal;

    // 渲染清單項目
    dom.cartItemsList.textContent = '';
    if (totals.detailedItems.length === 0) {
      dom.cartEmptyMsg.hidden = false;
      dom.cartItemsList.hidden = true;
      dom.clearCartBtn.hidden = true;
    } else {
      dom.cartEmptyMsg.hidden = true;
      dom.cartItemsList.hidden = false;
      dom.clearCartBtn.hidden = false;

      const fragment = document.createDocumentFragment();
      totals.detailedItems.forEach(function (item) {
        const li = document.createElement('li');
        li.className = 'cart-item';

        const info = document.createElement('div');
        info.className = 'cart-item-info';

        const titleWrap = document.createElement('div');
        const title = document.createElement('p');
        title.className = 'cart-item-title';
        title.textContent = item.name;

        const unit = document.createElement('span');
        unit.className = 'cart-item-unit';
        unit.textContent = '單價 NT$ ' + item.price + '／罐';

        titleWrap.appendChild(title);
        titleWrap.appendChild(unit);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-remove-item';
        removeBtn.setAttribute('aria-label', '移除 ' + item.name);
        removeBtn.textContent = '移除';
        removeBtn.addEventListener('click', function () {
          removeFromCart(item.id);
        });

        info.appendChild(titleWrap);
        info.appendChild(removeBtn);

        const controls = document.createElement('div');
        controls.className = 'cart-item-controls';

        const stepper = document.createElement('div');
        stepper.className = 'qty-stepper';

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'qty-btn';
        minusBtn.setAttribute('aria-label', '減少 ' + item.name + ' 數量');
        minusBtn.textContent = '−';
        minusBtn.addEventListener('click', function () {
          updateCartQty(item.id, item.qty - 1);
        });

        const qtySpan = document.createElement('span');
        qtySpan.className = 'qty-value';
        qtySpan.textContent = String(item.qty);

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'qty-btn';
        plusBtn.setAttribute('aria-label', '增加 ' + item.name + ' 數量');
        plusBtn.textContent = '+';
        plusBtn.addEventListener('click', function () {
          updateCartQty(item.id, item.qty + 1);
        });

        stepper.appendChild(minusBtn);
        stepper.appendChild(qtySpan);
        stepper.appendChild(plusBtn);

        const lineSubtotal = document.createElement('span');
        lineSubtotal.className = 'cart-item-subtotal';
        lineSubtotal.textContent = '小計 NT$ ' + item.lineTotal;

        controls.appendChild(stepper);
        controls.appendChild(lineSubtotal);

        li.appendChild(info);
        li.appendChild(controls);
        fragment.appendChild(li);
      });

      dom.cartItemsList.appendChild(fragment);
    }

    dom.orderSummaryPreview.value = buildOrderSummaryText(totals);
  }

  function showValidationAlert(message) {
    dom.preorderAlert.textContent = message;
    dom.preorderAlert.hidden = false;
    dom.exportFeedback.textContent = '';
  }

  function hideValidationAlert() {
    dom.preorderAlert.hidden = true;
    dom.preorderAlert.textContent = '';
  }

  function validatePreorderBeforeExport() {
    if (state.cart.length === 0) {
      showValidationAlert('⚠️ 您的預購清單目前是空的！請先到上方「商品型錄」挑選至少 1 罐能量飲再匯出明細。');
      return false;
    }
    const nickname = dom.nicknameInput.value.trim();
    if (!nickname) {
      showValidationAlert('⚠️ 請填寫「聯絡人暱稱」，方便我們在官方 LINE 或 IG 為您核對預購品項喔！');
      dom.nicknameInput.focus();
      return false;
    }
    hideValidationAlert();
    return true;
  }

  function initPreorderSection() {
    state.cart = loadCartFromStorage();
    renderCartAndSummary();

    dom.clearCartBtn.addEventListener('click', function () {
      state.cart = [];
      saveCartToStorage();
      renderCartAndSummary();
    });

    dom.applyCouponBtn.addEventListener('click', function () {
      state.appliedCoupon = dom.couponInput.value.trim().toUpperCase();
      dom.couponInput.value = state.appliedCoupon;
      renderCartAndSummary();
    });

    dom.couponInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        dom.applyCouponBtn.click();
      }
    });

    dom.nicknameInput.addEventListener('input', function () {
      if (dom.nicknameInput.value.trim()) {
        hideValidationAlert();
      }
      renderCartAndSummary();
    });

    dom.noteInput.addEventListener('input', function () {
      renderCartAndSummary();
    });

    // 複製明細按鈕
    dom.copySummaryBtn.addEventListener('click', function () {
      if (!validatePreorderBeforeExport()) return;
      const summaryText = dom.orderSummaryPreview.value;

      copyTextToClipboard(summaryText)
        .then(function () {
          dom.exportFeedback.textContent = '✓ 已複製預購明細！現在可直接打開 LINE 或 IG 貼上私訊給我們。';
        })
        .catch(function () {
          dom.orderSummaryPreview.select();
          dom.exportFeedback.textContent = '已為您選取明細文字，請按 Ctrl+C（或長按複製）貼至 LINE／IG。';
        });
    });

    // 下載 .txt 按鈕
    dom.downloadTxtBtn.addEventListener('click', function () {
      if (!validatePreorderBeforeExport()) return;
      const summaryText = dom.orderSummaryPreview.value;
      const safeNickname = dom.nicknameInput.value.trim().replace(/[\\/:*?"<>|\s]+/g, '_');

      const blob = new Blob(['\uFEFF' + summaryText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '育達樂活能量飲_預購明細_' + safeNickname + '.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      dom.exportFeedback.textContent = '✓ 已下載預購明細 .txt 檔案！歡迎傳送或貼上至品牌 LINE／IG。';
    });
  }

  /* ========================================================================
     啟動初始化
     ======================================================================== */
  initMobileMenu();
  initPromoBanner();
  initCatalogAndModal();
  renderReviews();
  renderFaqs();
  initPreorderSection();
})();
