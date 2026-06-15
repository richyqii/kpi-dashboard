export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && !url.searchParams.has("v")) {
      url.searchParams.set("v", "20260611a");
      return Response.redirect(url.toString(), 302);
    }
    return env.ASSETS.fetch(request);
  },
};
