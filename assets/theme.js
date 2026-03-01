(() => {
  const root = document.documentElement;
  const btn = document.getElementById("themeToggle");
  if (!btn) return;

  const sun = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" stroke="currentColor" stroke-width="2"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
  const moon = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 13.5A7.5 7.5 0 0 1 10.5 3 6.5 6.5 0 1 0 21 13.5Z"
            stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  `;

  function setTheme(theme) {
    root.dataset.theme = theme;
    localStorage.setItem("theme", theme);

    // Mostra o ícone do "tema oposto" (ação)
    const isLight = theme === "light";
    btn.innerHTML = isLight ? moon : sun;
    btn.title = isLight ? "Mudar para modo noturno" : "Mudar para modo claro";
    btn.setAttribute("aria-label", btn.title);
  }

  // tema inicial (já setado no head; aqui só sincroniza o botão)
  setTheme(root.dataset.theme || "dark");

  btn.addEventListener("click", () => {
    const cur = root.dataset.theme === "light" ? "light" : "dark";
    setTheme(cur === "light" ? "dark" : "light");
  });
})();