"use strict";

class ChartCard {
	constructor(parent, title, { size, titleColor, legend } = {}) {
		this.card = mkCard(parent, title, size);
		const h3 = this.card.querySelector("h3");
		if (titleColor && h3) h3.style.color = titleColor;
		if (legend) {
			const header = el("div", "chart-card-header");
			this.card.insertBefore(header, h3);
			header.appendChild(h3);
			header.appendChild(new ChartLegend(legend).render());
		}
		this.box = el("div", "chart-box");
		this.card.appendChild(this.box);
	}
	register(chart, registry = _barCharts) {
		registry.push(chart);
		return chart;
	}
}
