"use strict";

class ChartCard {
	constructor(parent, title, { size, titleColor, legend } = {}) {
		this.card = mkCard(parent, title, size);
		if (titleColor) {
			const h3 = this.card.querySelector("h3");
			if (h3) h3.style.color = titleColor;
		}
		if (legend) this.card.appendChild(new ChartLegend(legend).render());
		this.box = el("div", "chart-box");
		this.card.appendChild(this.box);
	}
	register(chart, registry = _barCharts) {
		registry.push(chart);
		return chart;
	}
}
