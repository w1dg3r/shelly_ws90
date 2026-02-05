'use strict';

class DebugLogger {
    constructor(maxEntries = 150) {
        this.entries = [];
        this.maxEntries = maxEntries;
        this.stats = {
            mqttConnections: 0,
            messagesReceived: 0,
            lastMessageTime: null,
            errors: 0
        };
    }

    log(level, category, message, data = null) {
        const entry = {
            t: new Date().toISOString(),
            l: level.toUpperCase(),
            c: category.toUpperCase(),
            m: message,
            d: data
        };

        this.entries.unshift(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.pop();
        }

        // Update stats
        if (level === 'ERROR') this.stats.errors++;
        if (category === 'MQTT' && message.includes('Connected')) this.stats.mqttConnections++;
        if (category === 'DATA' && message.includes('Received')) {
            this.stats.messagesReceived++;
            this.stats.lastMessageTime = entry.t;
        }

        // Also log to Homey's standard log if not too verbose
        console.log(`[${entry.l}][${entry.c}] ${message}`);
    }

    getAll() {
        return this.entries;
    }

    clear() {
        this.entries = [];
        this.log('INFO', 'SYSTEM', 'Log cleared');
    }

    getSummary() {
        return {
            ...this.stats,
            entryCount: this.entries.length,
            lastSeenSec: this.stats.lastMessageTime 
                ? Math.floor((Date.now() - new Date(this.stats.lastMessageTime).getTime()) / 1000)
                : null
        };
    }
}

module.exports = DebugLogger;
