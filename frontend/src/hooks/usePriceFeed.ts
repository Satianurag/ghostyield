import { useState, useEffect } from 'react';

/**
 * Hook to fetch real-time BTC price from Binance API
 * Polling every 5 seconds
 */
export function usePriceFeed() {
    const [price, setPrice] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchPrice = async () => {
        try {
            const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
            if (!response.ok) throw new Error('Binance API fetch failed');
            const data = await response.json();
            const btcPrice = parseFloat(data.price);
            setPrice(btcPrice);
            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            console.error('Price feed error:', err);
            setError('Failed to fetch live price');
        }
    };

    useEffect(() => {
        fetchPrice();
        const interval = setInterval(fetchPrice, 5000);
        return () => clearInterval(interval);
    }, []);

    return { price, lastUpdated, error };
}
