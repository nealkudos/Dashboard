// After a bank sign-in: hop back to the Budget page (a same-site navigation, so your login cookie is sent).
setTimeout(function () { location.replace(document.getElementById("go").getAttribute("href")); }, 1200);
