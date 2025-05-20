require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const endpoint = "https://api.pricempire.com/v4/paid/items/prices";
const sources = "steam,buff163,youpin";
const metas = ["liquidity"];
const headers = {
	Authorization: `Bearer ${process.env.PRICEMPIRE_API_KEY}`,
};

async function main() {
	try {
		console.log("Fetching all prices from Pricempire...");
		const { data: response } = await axios.get(endpoint, {
			params: {
				sources,
				metas,
			},
			headers,
		});

		// Calculate 1 hour ago timestamp
		const oneHourAgo = Date.now() - 60 * 60 * 1000;

		// Count items with up-to-date prices
		let upToDateCount = 0;
		let totalPriceCount = 0;
		let skippedPriceCount = 0;

		// Provider-specific statistics
		const providerStats = {};

		// Collection for outdated prices to save to JSON
		const outdatedPrices = [];

		response.forEach((item) => {
			if (item.prices && item.prices.length > 0) {
				// Filter out invalid prices (null updated_at or null price)
				const validPrices = item.prices.filter(
					(price) => price.updated_at !== null && price.price !== null
				);

				const invalidCount = item.prices.length - validPrices.length;
				skippedPriceCount += invalidCount;

				// Use only valid prices for statistics
				totalPriceCount += validPrices.length;

				validPrices.forEach((price) => {
					// Initialize provider stats if not exist
					if (!providerStats[price.provider_key]) {
						providerStats[price.provider_key] = {
							total: 0,
							upToDate: 0,
							oldestUpdate: Date.now(),
							newestUpdate: 0,
							avgPrice: 0,
							totalPrice: 0,
							skippedCount: 0,
						};
					}

					providerStats[price.provider_key].total += 1;
					providerStats[price.provider_key].totalPrice += price.price;

					// Check if the price was updated within the last hour
					const updateTimestamp = new Date(price.updated_at).getTime();

					// Track oldest and newest updates
					if (
						updateTimestamp < providerStats[price.provider_key].oldestUpdate
					) {
						providerStats[price.provider_key].oldestUpdate = updateTimestamp;
					}
					if (
						updateTimestamp > providerStats[price.provider_key].newestUpdate
					) {
						providerStats[price.provider_key].newestUpdate = updateTimestamp;
					}

					if (updateTimestamp >= oneHourAgo) {
						upToDateCount++;
						providerStats[price.provider_key].upToDate += 1;
					} else {
						// Add to outdated prices collection
						outdatedPrices.push({
							item_name: item.market_hash_name,
							provider: price.provider_key,
							price: price.price / 100, // Convert to dollars
							updated_at: price.updated_at,
							minutes_since_update: Math.floor(
								(Date.now() - updateTimestamp) / (60 * 1000)
							),
						});
					}
				});

				// Track skipped prices per provider
				item.prices.forEach((price) => {
					if (
						(price.updated_at === null || price.price === null) &&
						price.provider_key
					) {
						if (!providerStats[price.provider_key]) {
							providerStats[price.provider_key] = {
								total: 0,
								upToDate: 0,
								oldestUpdate: Date.now(),
								newestUpdate: 0,
								avgPrice: 0,
								totalPrice: 0,
								skippedCount: 0,
							};
						}
						providerStats[price.provider_key].skippedCount += 1;
					}
				});
			}
		});

		// Calculate averages and percentages for each provider
		Object.keys(providerStats).forEach((provider) => {
			const stats = providerStats[provider];
			stats.upToDatePercentage =
				stats.total > 0
					? ((stats.upToDate / stats.total) * 100).toFixed(2)
					: "0.00";
			stats.avgPrice =
				stats.total > 0
					? (stats.totalPrice / stats.total / 100).toFixed(2)
					: "0.00"; // Convert cents to dollars
			stats.oldestUpdateTime =
				stats.total > 0 ? new Date(stats.oldestUpdate).toISOString() : "N/A";
			stats.newestUpdateTime =
				stats.total > 0 ? new Date(stats.newestUpdate).toISOString() : "N/A";
			stats.oldestUpdateMinutesAgo =
				stats.total > 0
					? Math.floor((Date.now() - stats.oldestUpdate) / (60 * 1000))
					: "N/A";
			stats.newestUpdateMinutesAgo =
				stats.total > 0
					? Math.floor((Date.now() - stats.newestUpdate) / (60 * 1000))
					: "N/A";
		});

		// Get all prices
		// Sample output for a few random items
		console.log("\n📋 Sample Items (5 random examples):");
		console.log("----------------------------------");

		for (let i = 0; i < 5; i++) {
			if (i < response.length) {
				const randomIndex = Math.floor(Math.random() * response.length);
				const item = response[randomIndex];

				console.log(`Item: ${item.market_hash_name}`);
				console.log(`Liquidity: ${item.liquidity || "N/A"}`);
				console.log(`Steam Trades (7d): ${item.trades_7d || "N/A"}`);

				// Display prices from different sources
				if (item.prices && item.prices.length > 0) {
					console.log("Prices:");
					item.prices.forEach((price) => {
						if (price.updated_at === null || price.price === null) {
							console.log(
								`  ${price.provider_key}: INVALID DATA (missing ${
									price.updated_at === null ? "timestamp" : "price"
								})`
							);
							return;
						}

						const updateTimestamp = new Date(price.updated_at).getTime();
						const isUpToDate = updateTimestamp >= oneHourAgo ? "✅" : "❌";
						const minutesAgo = Math.floor(
							(Date.now() - updateTimestamp) / (60 * 1000)
						);

						console.log(
							`  ${price.provider_key}: $${
								(price.price / 100)?.toFixed(2) || "N/A"
							}, updated: ${
								price.updated_at
							} (${minutesAgo} mins ago) ${isUpToDate}`
						);
					});
				}

				console.log("----------------------------------");

				// Remove the selected item to avoid duplicates
				response.splice(randomIndex, 1);
			}
		}

		// Display the count of up-to-date prices
		console.log("\n📊 Overall Price Update Summary:");
		console.log(`Total valid prices: ${totalPriceCount}`);
		console.log(`Invalid prices (skipped): ${skippedPriceCount}`);
		console.log(
			`Up-to-date prices (updated within last hour): ${upToDateCount}`
		);
		console.log(`Outdated prices: ${outdatedPrices.length}`);
		console.log(
			`Percentage up-to-date: ${
				totalPriceCount > 0
					? ((upToDateCount / totalPriceCount) * 100).toFixed(2)
					: 0
			}%`
		);

		// Display provider-specific statistics
		console.log("\n📊 Provider-specific Statistics:");
		console.log("----------------------------------");

		Object.keys(providerStats)
			.sort()
			.forEach((provider) => {
				const stats = providerStats[provider];
				console.log(`\nProvider: ${provider}`);
				console.log(`Total valid prices: ${stats.total}`);
				console.log(`Invalid prices (skipped): ${stats.skippedCount}`);
				console.log(
					`Up-to-date (within 1 hour): ${stats.upToDate} (${stats.upToDatePercentage}%)`
				);
				console.log(`Average price: $${stats.avgPrice}`);

				if (stats.total > 0) {
					console.log(
						`Oldest update: ${stats.oldestUpdateTime} (${stats.oldestUpdateMinutesAgo} mins ago)`
					);
					console.log(
						`Newest update: ${stats.newestUpdateTime} (${stats.newestUpdateMinutesAgo} mins ago)`
					);
				} else {
					console.log(`No valid price data available for this provider`);
				}
			});

		// Find provider with best and worst up-to-date percentage
		let bestProvider = "";
		let worstProvider = "";
		let bestPercentage = -1;
		let worstPercentage = 101;

		Object.keys(providerStats).forEach((provider) => {
			const stats = providerStats[provider];
			if (stats.total > 0) {
				const upToDatePct = parseFloat(stats.upToDatePercentage);
				if (upToDatePct > bestPercentage) {
					bestPercentage = upToDatePct;
					bestProvider = provider;
				}
				if (upToDatePct < worstPercentage) {
					worstPercentage = upToDatePct;
					worstProvider = provider;
				}
			}
		});

		console.log("\n📈 Provider Rankings:");
		if (bestProvider) {
			console.log(
				`Most up-to-date provider: ${bestProvider} (${bestPercentage}%)`
			);
		}
		if (worstProvider) {
			console.log(
				`Least up-to-date provider: ${worstProvider} (${worstPercentage}%)`
			);
		}

		console.log("\n🔍 Data Quality Analysis:");
		console.log(
			`Total data quality: ${(
				(totalPriceCount / (totalPriceCount + skippedPriceCount)) *
				100
			).toFixed(2)}% valid prices`
		);

		// Save outdated prices to JSON file
		if (outdatedPrices.length > 0) {
			const timestamp = new Date()
				.toISOString()
				.replace(/:/g, "-")
				.replace(/\..+/, "");
			const filename = `outdated_prices_${timestamp}.json`;
			const outputPath = path.join(__dirname, filename);

			// Create the JSON object with metadata
			const outputData = {
				generated_at: new Date().toISOString(),
				total_outdated_prices: outdatedPrices.length,
				time_threshold_minutes: 60,
				prices: outdatedPrices,
			};

			// Write to file
			fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
			console.log(
				`\n💾 Saved ${outdatedPrices.length} outdated prices to: ${filename}`
			);
		} else {
			console.log("\n✅ No outdated prices to save!");
		}
	} catch (error) {
		console.log(error.response?.data || error);
		console.error("Error fetching prices:", error.message);
	}
}

// Run the main function
main();
