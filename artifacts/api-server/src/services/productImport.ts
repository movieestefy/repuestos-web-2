import * as xlsx from "xlsx";

export interface ParsedProductRow {
  sku: string;
  name: string;
  category: string;
  brand?: string;
  compatibleModels?: string;
  location?: string;
  description: string;
  priceUsd: number;
  stock: number;
  condition: "new" | "used" | "refurbished";
  isVisible: boolean;
}

/**
 * Parses an Excel (.xlsx, .xls) or CSV buffer and extracts valid product records.
 */
export function parseProductFile(buffer: Buffer): { rows: ParsedProductRow[]; errors: string[] } {
  const workbook = xlsx.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("El archivo no contiene hojas válidas.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows: Record<string, any>[] = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  if (!rawRows || rawRows.length === 0) {
    throw new Error("El archivo está vacío o no contiene filas con datos.");
  }

  const rows: ParsedProductRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNum = i + 2; // header is row 1

    // Extract fields matching various header variations (Spanish/English)
    const name = String(
      raw["Nombre"] || raw["nombre"] || raw["Name"] || raw["Producto"] || raw["producto"] || ""
    ).trim();

    if (!name) {
      errors.push(`Fila ${rowNum}: Falta el nombre del repuesto.`);
      continue;
    }

    let sku = String(
      raw["SKU"] || raw["sku"] || raw["Código"] || raw["Codigo"] || raw["codigo"] || ""
    ).trim();

    if (!sku) {
      // Auto-generate SKU from name
      sku = `SKU-${name.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}-${i + 1}`;
    }

    const category = String(
      raw["Categoría"] || raw["Categoria"] || raw["categoria"] || raw["Category"] || "Repuestos"
    ).trim();

    const brand = String(raw["Marca"] || raw["marca"] || raw["Brand"] || "").trim();
    const app = String(
      raw["Aplica para (Motos)"] ||
      raw["Aplica para"] ||
      raw["Modelos"] ||
      raw["Aplicación"] ||
      raw["Aplicacion"] ||
      raw["Modelo"] ||
      raw["Moto"] ||
      ""
    ).trim();
    const location = String(
      raw["Ubicación (Pasillo/Estante)"] ||
      raw["Ubicación"] ||
      raw["Ubicacion"] ||
      raw["Pasillo"] ||
      raw["Estante"] ||
      raw["Location"] ||
      ""
    ).trim();
    let desc = String(
      raw["Descripción Breve"] ||
      raw["Descripción"] ||
      raw["Descripcion"] ||
      raw["Description"] ||
      ""
    ).trim();

    // Enrich description with Brand, Application, and Location if provided
    const extras: string[] = [];
    if (brand) extras.push(`Marca: ${brand}`);
    if (app) extras.push(`Aplicación: ${app}`);
    if (location) extras.push(`Ubicación: ${location}`);
    if (extras.length > 0) {
      desc = desc ? `${desc} (${extras.join(" | ")})` : extras.join(" | ");
    }

    // Price USD
    const rawPrice =
      raw["Precio (USD)"] ??
      raw["Precio USD"] ??
      raw["Precio"] ??
      raw["precio"] ??
      raw["priceUsd"] ??
      raw["USD"] ??
      raw["Precio ($)"];
    const cleanedPriceStr = String(rawPrice).replace(/[$,\s]/g, "");
    const priceUsd = Number(cleanedPriceStr);

    if (isNaN(priceUsd) || priceUsd <= 0) {
      errors.push(`Fila ${rowNum} (${name}): Precio USD inválido (${rawPrice}). Debe ser mayor a 0.`);
      continue;
    }

    // Stock Inicial
    const rawStock =
      raw["Stock Inicial"] ??
      raw["Stock"] ??
      raw["stock"] ??
      raw["Cantidad"] ??
      raw["cantidad"] ??
      0;
    const stock = Math.max(0, parseInt(String(rawStock), 10) || 0);

    // Condition
    const rawCond = String(raw["Condición"] || raw["Condicion"] || raw["condition"] || "new")
      .trim()
      .toLowerCase();
    let condition: "new" | "used" | "refurbished" = "new";
    if (rawCond.includes("usad") || rawCond === "used") {
      condition = "used";
    } else if (rawCond.includes("reacon") || rawCond === "refurbished") {
      condition = "refurbished";
    }

    rows.push({
      sku,
      name,
      category: category || "Repuestos",
      brand: brand || undefined,
      compatibleModels: app || undefined,
      location: location || undefined,
      description: desc || name,
      priceUsd: Math.round(priceUsd * 100) / 100,
      stock,
      condition,
      isVisible: true,
    });
  }

  return { rows, errors };
}
