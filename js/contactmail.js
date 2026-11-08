(function () {
  var a = document.getElementById('mailto'); if (!a) return;
  var addr = ['hello', 'govibemix.com'].join('@');
  a.href = 'mailto:' + addr; a.textContent = addr;
})();
