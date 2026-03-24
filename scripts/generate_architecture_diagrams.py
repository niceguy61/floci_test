#!/usr/bin/env python3
from __future__ import annotations

import html
from pathlib import Path
from urllib.parse import quote
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "assets" / "aws-icons"


def data_uri(path: Path) -> str:
    raw = path.read_text(encoding="utf-8")
    encoded = quote(raw, safe="")
    return f"data:image/svg+xml,{encoded}"


ICONS = {
    "users": data_uri(ICON_DIR / "general" / "users.svg"),
    "client": data_uri(ICON_DIR / "general" / "client.svg"),
    "application": data_uri(ICON_DIR / "general" / "application.svg"),
    "s3_bucket": data_uri(ICON_DIR / "storage" / "s3-bucket.svg"),
    "dynamodb_table": data_uri(ICON_DIR / "databases" / "dynamodb-table.svg"),
    "sqs_queue": data_uri(ICON_DIR / "integration" / "sqs-queue.svg"),
    "sns_topic": data_uri(ICON_DIR / "integration" / "sns-topic.svg"),
    "cognito": data_uri(ICON_DIR / "security" / "cognito.svg"),
}


DIAGRAMS = {
    "image-gallery": {
        "title": "Image Gallery",
        "subtitle": "Local hands-on architecture using floci + AWS official icons",
        "size": (1280, 720),
        "containers": [
            {"id": "c1", "x": 40, "y": 92, "w": 240, "h": 540, "label": "Client"},
            {"id": "c2", "x": 320, "y": 92, "w": 250, "h": 540, "label": "Local app runtime"},
            {
                "id": "c3",
                "x": 610,
                "y": 92,
                "w": 620,
                "h": 540,
                "label": "floci endpoint / AWS local services",
            },
        ],
        "nodes": [
            {"id": "n1", "icon": "users", "label": "User", "x": 105, "y": 175},
            {"id": "n2", "icon": "client", "label": "Browser / Web UI", "x": 105, "y": 355},
            {"id": "n3", "icon": "application", "label": "Image API Server", "x": 405, "y": 265},
            {
                "id": "n4",
                "icon": "s3_bucket",
                "label": "Amazon S3 bucket\noriginal / display / thumbnail",
                "x": 760,
                "y": 215,
            },
            {
                "id": "n5",
                "icon": "dynamodb_table",
                "label": "Amazon DynamoDB table\nimage_metadata",
                "x": 980,
                "y": 215,
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source": "n1",
                "target": "n2",
                "label": "upload / browse",
                "source_anchor": (0.5, 1.0),
                "target_anchor": (0.5, 0.0),
                "points": [(165, 325)],
            },
            {
                "id": "e2",
                "source": "n2",
                "target": "n3",
                "label": "HTTP",
                "source_anchor": (1.0, 0.45),
                "target_anchor": (0.0, 0.55),
                "points": [(285, 409), (285, 331)],
            },
            {
                "id": "e3",
                "source": "n3",
                "target": "n4",
                "label": "put/get object",
                "source_anchor": (1.0, 0.35),
                "target_anchor": (0.0, 0.5),
                "points": [(610, 300), (610, 275)],
            },
            {
                "id": "e4",
                "source": "n3",
                "target": "n5",
                "label": "put/scan metadata",
                "source_anchor": (1.0, 0.72),
                "target_anchor": (0.0, 0.5),
                "points": [(700, 368), (700, 275)],
            },
        ],
    },
    "order-processing": {
        "title": "Order Processing",
        "subtitle": "Async order workflow with SQS + SNS fan-out",
        "size": (1420, 780),
        "containers": [
            {"id": "c1", "x": 40, "y": 92, "w": 240, "h": 600, "label": "Client"},
            {"id": "c2", "x": 320, "y": 92, "w": 270, "h": 600, "label": "Local app runtime"},
            {
                "id": "c3",
                "x": 630,
                "y": 92,
                "w": 740,
                "h": 600,
                "label": "floci endpoint / AWS local services",
            },
        ],
        "nodes": [
            {"id": "n1", "icon": "users", "label": "User", "x": 105, "y": 160},
            {"id": "n2", "icon": "client", "label": "Browser / Web UI", "x": 105, "y": 340},
            {"id": "n3", "icon": "application", "label": "Order API Server", "x": 405, "y": 180},
            {"id": "n4", "icon": "application", "label": "Worker", "x": 405, "y": 430},
            {
                "id": "n5",
                "icon": "dynamodb_table",
                "label": "Amazon DynamoDB table\norders",
                "x": 720,
                "y": 180,
            },
            {
                "id": "n6",
                "icon": "sqs_queue",
                "label": "Amazon SQS queue\norder-processing-queue",
                "x": 940,
                "y": 180,
            },
            {
                "id": "n7",
                "icon": "sns_topic",
                "label": "Amazon SNS topic\norder-processing-topic",
                "x": 1160,
                "y": 180,
            },
            {
                "id": "n8",
                "icon": "sqs_queue",
                "label": "Amazon SQS queue\norder-processing-events",
                "x": 1160,
                "y": 430,
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source": "n1",
                "target": "n2",
                "label": "create order",
                "source_anchor": (0.5, 1.0),
                "target_anchor": (0.5, 0.0),
                "points": [(165, 310)],
            },
            {
                "id": "e2",
                "source": "n2",
                "target": "n3",
                "label": "HTTP",
                "source_anchor": (1.0, 0.45),
                "target_anchor": (0.0, 0.5),
                "points": [(300, 394), (300, 240)],
            },
            {
                "id": "e3",
                "source": "n3",
                "target": "n5",
                "label": "PENDING",
                "source_anchor": (1.0, 0.42),
                "target_anchor": (0.0, 0.42),
                "points": [(650, 230)],
            },
            {
                "id": "e4",
                "source": "n3",
                "target": "n6",
                "label": "enqueue",
                "source_anchor": (1.0, 0.68),
                "target_anchor": (0.0, 0.42),
                "points": [(760, 262)],
            },
            {
                "id": "e5",
                "source": "n6",
                "target": "n4",
                "label": "poll",
                "source_anchor": (0.0, 0.65),
                "target_anchor": (1.0, 0.25),
                "points": [(820, 258), (820, 457)],
            },
            {
                "id": "e6",
                "source": "n4",
                "target": "n5",
                "label": "PROCESSING / COMPLETED",
                "source_anchor": (1.0, 0.5),
                "target_anchor": (0.0, 0.7),
                "points": [(620, 490), (620, 250)],
            },
            {
                "id": "e7",
                "source": "n4",
                "target": "n7",
                "label": "publish status",
                "source_anchor": (1.0, 0.28),
                "target_anchor": (0.0, 0.7),
                "points": [(720, 458), (720, 324), (1100, 324)],
            },
            {
                "id": "e8",
                "source": "n7",
                "target": "n8",
                "label": "fan-out",
                "source_anchor": (0.5, 1.0),
                "target_anchor": (0.5, 0.0),
                "points": [(1220, 370)],
            },
        ],
    },
    "auth-portal": {
        "title": "Auth Portal",
        "subtitle": "Cognito-first login flow for local hands-on",
        "size": (1220, 720),
        "containers": [
            {"id": "c1", "x": 40, "y": 92, "w": 240, "h": 540, "label": "Client"},
            {"id": "c2", "x": 320, "y": 92, "w": 250, "h": 540, "label": "Local app runtime"},
            {
                "id": "c3",
                "x": 610,
                "y": 92,
                "w": 560,
                "h": 540,
                "label": "floci endpoint / AWS local services",
            },
        ],
        "nodes": [
            {"id": "n1", "icon": "users", "label": "User", "x": 105, "y": 175},
            {"id": "n2", "icon": "client", "label": "Browser / Web UI", "x": 105, "y": 355},
            {"id": "n3", "icon": "application", "label": "Auth API Server", "x": 405, "y": 265},
            {
                "id": "n4",
                "icon": "cognito",
                "label": "Amazon Cognito\nUser Pool + App Client",
                "x": 850,
                "y": 265,
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source": "n1",
                "target": "n2",
                "label": "sign up / sign in",
                "source_anchor": (0.5, 1.0),
                "target_anchor": (0.5, 0.0),
                "points": [(165, 325)],
            },
            {
                "id": "e2",
                "source": "n2",
                "target": "n3",
                "label": "HTTP",
                "source_anchor": (1.0, 0.45),
                "target_anchor": (0.0, 0.55),
                "points": [(285, 409), (285, 331)],
            },
            {
                "id": "e3",
                "source": "n3",
                "target": "n4",
                "label": "sign-up / confirm / auth",
                "source_anchor": (1.0, 0.5),
                "target_anchor": (0.0, 0.5),
                "points": [(650, 315)],
            },
        ],
    },
}


NODE_W = 120
NODE_H = 120


def drawio_style(icon_data_uri: str) -> str:
    return (
        "shape=image;verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;"
        "align=center;imageAspect=0;aspect=fixed;html=1;whiteSpace=wrap;spacingTop=6;"
        "fontSize=14;fontStyle=0;image="
        + icon_data_uri
    )


def drawio_label(value: str) -> str:
    if "\n" not in value:
        return html.escape(value)
    return "".join(f"<div>{html.escape(line)}</div>" for line in value.split("\n"))


def add_geometry(parent: ET.Element, x: int, y: int, w: int, h: int, relative: bool = False) -> None:
    attrs = {"as": "geometry"}
    if relative:
        attrs["relative"] = "1"
    geom = ET.SubElement(parent, "mxGeometry", attrs)
    if not relative:
        geom.set("x", str(x))
        geom.set("y", str(y))
        geom.set("width", str(w))
        geom.set("height", str(h))


def build_drawio_xml(spec: dict) -> str:
    width, height = spec["size"]
    model = ET.Element(
        "mxGraphModel",
        {
            "dx": "1600",
            "dy": "1000",
            "grid": "1",
            "gridSize": "10",
            "guides": "1",
            "tooltips": "1",
            "connect": "1",
            "arrows": "1",
            "fold": "1",
            "page": "1",
            "pageScale": "1",
            "pageWidth": str(width),
            "pageHeight": str(height),
            "math": "0",
            "shadow": "0",
            "adaptiveColors": "auto",
        },
    )
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})

    title = ET.SubElement(
        root,
        "mxCell",
        {
            "id": "title",
            "value": html.escape(spec["title"]),
            "style": "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;"
            "fontSize=24;fontStyle=1;",
            "vertex": "1",
            "parent": "1",
        },
    )
    add_geometry(title, 40, 24, 500, 32)

    subtitle = ET.SubElement(
        root,
        "mxCell",
        {
            "id": "subtitle",
            "value": html.escape(spec["subtitle"]),
            "style": "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;"
            "fontSize=13;fontColor=#4b5563;",
            "vertex": "1",
            "parent": "1",
        },
    )
    add_geometry(subtitle, 40, 56, 720, 22)

    for container in spec["containers"]:
        cell = ET.SubElement(
            root,
            "mxCell",
            {
                "id": container["id"],
                "value": html.escape(container["label"]),
                "style": "rounded=1;whiteSpace=wrap;html=1;dashed=1;dashPattern=8 8;arcSize=10;"
                "strokeWidth=2;strokeColor=#7f8ea3;fillColor=none;align=left;verticalAlign=top;"
                "spacingLeft=12;spacingTop=10;fontSize=15;fontStyle=1;",
                "vertex": "1",
                "parent": "1",
            },
        )
        add_geometry(cell, container["x"], container["y"], container["w"], container["h"])

    for node in spec["nodes"]:
        cell = ET.SubElement(
            root,
            "mxCell",
            {
                "id": node["id"],
                "value": drawio_label(node["label"]),
                "style": drawio_style(ICONS[node["icon"]]),
                "vertex": "1",
                "parent": "1",
            },
        )
        add_geometry(cell, node["x"], node["y"], NODE_W, NODE_H)

    for edge in spec["edges"]:
        source_anchor = edge.get("source_anchor", (1.0, 0.5))
        target_anchor = edge.get("target_anchor", (0.0, 0.5))
        cell = ET.SubElement(
            root,
            "mxCell",
            {
                "id": edge["id"],
                "value": html.escape(edge["label"]),
                "style": "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;"
                "html=1;strokeWidth=2;fontSize=12;labelBackgroundColor=#ffffff;"
                f"exitX={source_anchor[0]};exitY={source_anchor[1]};exitDx=0;exitDy=0;"
                f"entryX={target_anchor[0]};entryY={target_anchor[1]};entryDx=0;entryDy=0;",
                "edge": "1",
                "parent": "1",
                "source": edge["source"],
                "target": edge["target"],
            },
        )
        geom = ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})
        if edge.get("points"):
            arr = ET.SubElement(geom, "Array", {"as": "points"})
            for x, y in edge["points"]:
                ET.SubElement(arr, "mxPoint", {"x": str(x), "y": str(y)})

    return ET.tostring(model, encoding="unicode")


def svg_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def text_lines(value: str) -> list[str]:
    return value.split("\n")


def anchor_point(node: dict, anchor: tuple[float, float]) -> tuple[float, float]:
    ax, ay = anchor
    return (node["x"] + (NODE_W * ax), node["y"] + ((NODE_H - 20) * ay))


def edge_path_points(edge: dict, nodes: dict[str, dict]) -> list[tuple[float, float]]:
    points = [anchor_point(nodes[edge["source"]], edge.get("source_anchor", (1.0, 0.5)))]
    points.extend(edge.get("points", []))
    points.append(anchor_point(nodes[edge["target"]], edge.get("target_anchor", (0.0, 0.5))))
    return points


def arrow_polygon(points: list[tuple[float, float]]) -> str:
    end_x, end_y = points[-1]
    prev_x, prev_y = points[-2]
    dx = end_x - prev_x
    dy = end_y - prev_y

    if abs(dx) >= abs(dy):
        sign = 1 if dx >= 0 else -1
        p2 = (end_x - (12 * sign), end_y - 6)
        p3 = (end_x - (12 * sign), end_y + 6)
    else:
        sign = 1 if dy >= 0 else -1
        p2 = (end_x - 6, end_y - (12 * sign))
        p3 = (end_x + 6, end_y - (12 * sign))

    return f"{end_x},{end_y} {p2[0]},{p2[1]} {p3[0]},{p3[1]}"


def build_svg(spec: dict) -> str:
    width, height = spec["size"]
    nodes = {node["id"]: node for node in spec["nodes"]}
    lines: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
        f'<text x="40" y="44" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#111827">{svg_escape(spec["title"])}</text>',
        f'<text x="40" y="70" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#4b5563">{svg_escape(spec["subtitle"])}</text>',
    ]

    for container in spec["containers"]:
        lines.append(
            f'<rect x="{container["x"]}" y="{container["y"]}" width="{container["w"]}" height="{container["h"]}" '
            'rx="18" ry="18" fill="none" stroke="#7f8ea3" stroke-width="2" stroke-dasharray="8 8"/>'
        )
        lines.append(
            f'<text x="{container["x"] + 16}" y="{container["y"] + 28}" font-family="Arial, Helvetica, sans-serif" '
            f'font-size="18" font-weight="700" fill="#1f2937">{svg_escape(container["label"])}</text>'
        )

    for edge in spec["edges"]:
        points = edge_path_points(edge, nodes)
        path = "M " + " L ".join(f"{x} {y}" for x, y in points)
        lines.append(
            f'<path d="{path}" fill="none" stroke="#425466" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        lines.append(
            f'<polygon points="{arrow_polygon(points)}" fill="#425466"/>'
        )
        segment_index = max(0, (len(points) - 2) // 2)
        x1, y1 = points[segment_index]
        x2, y2 = points[segment_index + 1]
        label_x = ((x1 + x2) / 2) + 8
        label_y = ((y1 + y2) / 2) - 8
        lines.append(
            f'<rect x="{label_x - 6}" y="{label_y - 16}" width="{max(80, len(edge["label"]) * 7)}" height="22" fill="#ffffff"/>'
        )
        lines.append(
            f'<text x="{label_x}" y="{label_y}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#334155">{svg_escape(edge["label"])}</text>'
        )

    for node in spec["nodes"]:
        lines.append(
            f'<image x="{node["x"]}" y="{node["y"]}" width="{NODE_W}" height="{NODE_H - 20}" href="{ICONS[node["icon"]]}"/>'
        )
        for index, line in enumerate(text_lines(node["label"])):
            y = node["y"] + NODE_H - 4 + (index * 18)
            lines.append(
                f'<text x="{node["x"] + NODE_W / 2}" y="{y}" text-anchor="middle" '
                'font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#111827">'
                f"{svg_escape(line)}</text>"
            )

    lines.append("</svg>")
    return "\n".join(lines)


def main() -> None:
    for app, spec in DIAGRAMS.items():
        asset_dir = ROOT / "apps" / app / "assets"
        asset_dir.mkdir(parents=True, exist_ok=True)
        drawio_path = asset_dir / f"{app}-architecture.drawio"
        svg_path = asset_dir / f"{app}-architecture.svg"
        drawio_path.write_text(build_drawio_xml(spec), encoding="utf-8")
        svg_path.write_text(build_svg(spec), encoding="utf-8")
        print(f"generated {drawio_path.relative_to(ROOT)}")
        print(f"generated {svg_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
