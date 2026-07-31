import { nextValue } from "@/server/bfcache-data";

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name");

  if (name === null || name === "") {
    return Response.json({ error: "name required" }, { status: 400 });
  }

  return Response.json({ data: nextValue(name, "loader") });
}
