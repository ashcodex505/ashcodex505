#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_USERNAME = "ashcodex505";
const DEFAULT_OUTPUT_DIR = "assets";
const SVG_WIDTH = 846;
const SVG_HEIGHT = 178;
const CELL_SIZE = 11;
const CELL_GAP = 3;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const GRID_LEFT = 46;
const GRID_TOP = 58;

const THEMES = {
  light: {
    background: "#ffffff",
    border: "#d0d7de",
    text: "#1f2328",
    muted: "#57606a",
    cells: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    cellBorder: "rgba(27,31,36,0.06)",
  },
  dark: {
    background: "#0d1117",
    border: "#30363d",
    text: "#f0f6fc",
    muted: "#8b949e",
    cells: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    cellBorder: "rgba(240,246,252,0.08)",
  },
};

function readArguments(argv) {
  const values = {
    username: DEFAULT_USERNAME,
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--username") {
      values.username = argv[index + 1];
      index += 1;
    } else if (argument === "--output-dir") {
      values.outputDir = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!/^[a-zd](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(values.username)) {
    throw new Error(`Invalid GitHub username: ${values.username}`);
  }

  return values;
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeHtml(match[2]);
  }
  return attributes;
}

function parseContributionCalendar(html) {
  const countsByCellId = new Map();
  const tooltipPattern = /<tool-tip\b[^>]*>[\s\S]*?<\/tool-tip>/g;

  for (const match of html.matchAll(tooltipPattern)) {
    const tooltip = match[0];
    const attributes = parseAttributes(tooltip.slice(0, tooltip.indexOf(">") + 1));
    const text = decodeHtml(tooltip.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const countMatch = text.match(/^([\d,]+)\s+contributions?\s+on\s+/i);

    if (attributes.for && countMatch) {
      countsByCellId.set(attributes.for, Number(countMatch[1].replaceAll(",", "")));
    }
  }

  const days = [];
  const cellPattern = /<td\b[^>]*\bdata-date="[^"]+"[^>]*>/g;

  for (const match of html.matchAll(cellPattern)) {
    const attributes = parseAttributes(match[0]);
    const level = Number(attributes["data-level"]);

    if (!attributes["data-date"] || !attributes.id || !Number.isInteger(level)) {
      continue;
    }

    days.push({
      date: attributes["data-date"],
      level: Math.max(0, Math.min(4, level)),
      count: countsByCellId.get(attributes.id) ?? 0,
    });
  }

  if (days.length < 350) {
    throw new Error(`Expected a full contribution calendar, but GitHub returned ${days.length} days.`);
  }

  return days.sort((left, right) => left.date.localeCompare(right.date));
}

function utcDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function differenceInDays(left, right) {
  return Math.round((left.getTime() - right.getTime()) / 86_400_000);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(date));
}

function renderSvg(username, days, themeName) {
  const theme = THEMES[themeName];
  const startDate = utcDate(days[0].date);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const monthLabels = [];
  const monthKeys = new Set();

  for (const day of days) {
    const date = utcDate(day.date);
    const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (monthKeys.has(monthKey)) continue;

    monthKeys.add(monthKey);
    monthLabels.push({
      label: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date),
      week: Math.floor(differenceInDays(date, startDate) / 7),
    });
  }

  const fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
  const svg = [];
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-labelledby="title description">`);
  svg.push(`  <title id="title">${escapeXml(username)} GitHub contribution calendar</title>`);
  svg.push(`  <desc id="description">${total.toLocaleString("en-US")} contributions in the last year, shown as a GitHub-style daily activity grid.</desc>`);
  svg.push(`  <rect x="0.5" y="0.5" width="${SVG_WIDTH - 1}" height="${SVG_HEIGHT - 1}" rx="6" fill="${theme.background}" stroke="${theme.border}"/>`);
  svg.push(`  <text x="16" y="27" fill="${theme.text}" font-family="${fontFamily}" font-size="14" font-weight="600">${total.toLocaleString("en-US")} contributions in the last year</text>`);

  for (const month of monthLabels) {
    const x = GRID_LEFT + month.week * CELL_STEP;
    if (x <= SVG_WIDTH - 42) {
      svg.push(`  <text x="${x}" y="49" fill="${theme.muted}" font-family="${fontFamily}" font-size="11">${month.label}</text>`);
    }
  }

  const weekdayLabels = [
    { label: "Mon", row: 1 },
    { label: "Wed", row: 3 },
    { label: "Fri", row: 5 },
  ];

  for (const weekday of weekdayLabels) {
    const y = GRID_TOP + weekday.row * CELL_STEP + 9;
    svg.push(`  <text x="12" y="${y}" fill="${theme.muted}" font-family="${fontFamily}" font-size="11">${weekday.label}</text>`);
  }

  for (const day of days) {
    const date = utcDate(day.date);
    const week = Math.floor(differenceInDays(date, startDate) / 7);
    const weekday = date.getUTCDay();
    const x = GRID_LEFT + week * CELL_STEP;
    const y = GRID_TOP + weekday * CELL_STEP;
    const contributionLabel = `${day.count.toLocaleString("en-US")} ${day.count === 1 ? "contribution" : "contributions"} on ${formatDate(day.date)}`;

    svg.push(`  <rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="2" fill="${theme.cells[day.level]}" stroke="${theme.cellBorder}" stroke-width="1">`);
    svg.push(`    <title>${escapeXml(contributionLabel)}</title>`);
    svg.push("  </rect>");
  }

  const legendY = 164;
  const legendCellX = 710;
  svg.push(`  <text x="678" y="${legendY + 9}" fill="${theme.muted}" font-family="${fontFamily}" font-size="11">Less</text>`);
  theme.cells.forEach((color, index) => {
    svg.push(`  <rect x="${legendCellX + index * 15}" y="${legendY}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="2" fill="${color}" stroke="${theme.cellBorder}" stroke-width="1"/>`);
  });
  svg.push(`  <text x="789" y="${legendY + 9}" fill="${theme.muted}" font-family="${fontFamily}" font-size="11">More</text>`);
  svg.push("</svg>");

  return `${svg.join("\n")}\n`;
}

async function main() {
  const { username, outputDir } = readArguments(process.argv.slice(2));
  const endpoint = `https://github.com/users/${encodeURIComponent(username)}/contributions`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "text/html",
      "User-Agent": "ashcodex505-profile-contribution-generator/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub contribution request failed with HTTP ${response.status}.`);
  }

  const days = parseContributionCalendar(await response.text());
  await mkdir(outputDir, { recursive: true });

  for (const themeName of Object.keys(THEMES)) {
    const destination = path.join(outputDir, `contributions-${themeName}.svg`);
    await writeFile(destination, renderSvg(username, days, themeName), "utf8");
    console.log(`Generated ${destination}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
