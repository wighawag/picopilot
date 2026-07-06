// A fully static site: prerender every route to plain HTML for GitHub Pages,
// and emit trailing-slash dirs so paths resolve under the Pages subpath.
export const prerender = true;
export const trailingSlash = 'always';
