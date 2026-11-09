/** Shows [data-billing-on] and hides [data-billing-off] when Stripe billing is enabled on the API. */
(function () {
  const on = document.querySelectorAll("[data-billing-on]");
  const off = document.querySelectorAll("[data-billing-off]");
  if (!on.length && !off.length) return;

  fetch("https://api.webmailagent.com/v1/upgrade/config")
    .then((res) => (res.ok ? res.json() : { billing: false }))
    .then((cfg) => {
      if (!cfg || cfg.billing !== true) return;
      on.forEach((el) => (el.hidden = false));
      off.forEach((el) => (el.hidden = true));
    })
    .catch(() => {});
})();
