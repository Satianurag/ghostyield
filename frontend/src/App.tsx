import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import BitcoinWalletButton from './components/BitcoinWalletButton';
import Dashboard from './pages/Dashboard';
import CreateVault from './pages/CreateVault';
import Borrow from './pages/Borrow';
import Repay from './pages/Repay';
import Lend from './pages/Lend';

function App() {
    const location = useLocation();
    const { isConnected } = useAccount();

    const navItems = [
        { path: '/', label: 'Dashboard', icon: '📊' },
        { path: '/vault', label: 'Create Vault', icon: '🔐' },
        { path: '/borrow', label: 'Borrow', icon: '💵' },
        { path: '/repay', label: 'Repay', icon: '💳' },
        { path: '/lend', label: 'Earn Yield', icon: '📈' },
    ];

    return (
        <div className="min-h-screen bg-gray-950">
            {/* Header */}
            <header className="border-b border-white/10 bg-gray-950/80 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        {/* Logo */}
                        <Link to="/" className="flex items-center gap-2">
                            <span className="text-3xl">👻</span>
                            <span className="text-xl font-bold text-white">GhostYield</span>
                        </Link>

                        {/* Navigation */}
                        <nav className="hidden md:flex items-center gap-1">
                            {navItems.map((item) => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${location.pathname === item.path
                                        ? 'bg-ghost-500/20 text-ghost-400'
                                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    <span className="mr-2">{item.icon}</span>
                                    {item.label}
                                </Link>
                            ))}
                        </nav>
                    </div>

                    {/* Connect Wallets - Bitcoin + EVM */}
                    <div className="flex items-center gap-3">
                        <BitcoinWalletButton />
                        <ConnectButton />
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 py-8">
                {!isConnected ? (
                    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                        <span className="text-8xl mb-6">👻</span>
                        <h1 className="text-4xl font-bold mb-4">Welcome to GhostYield</h1>
                        <p className="text-gray-400 text-lg mb-8 max-w-md">
                            Lock your Bitcoin, generate ZK proofs, and borrow stablecoins without bridges.
                        </p>
                        <ConnectButton />
                    </div>
                ) : (
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/vault" element={<CreateVault />} />
                        <Route path="/borrow" element={<Borrow />} />
                        <Route path="/repay" element={<Repay />} />
                        <Route path="/lend" element={<Lend />} />
                    </Routes>
                )}
            </main>

            {/* Footer */}
            <footer className="border-t border-white/10 py-8 mt-16">
                <div className="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
                    <p>GhostYield Protocol • Powered by Charms & BitcoinOS</p>
                </div>
            </footer>
        </div>
    );
}

export default App;
