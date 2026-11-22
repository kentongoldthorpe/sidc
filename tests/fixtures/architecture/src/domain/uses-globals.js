export function save(coa) {
  localStorage.setItem('k', JSON.stringify(coa));
  return window.location.href;
}
