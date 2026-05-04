# Top 3 JavaScript Date Formatting Libraries

A comprehensive comparison of the best JavaScript date formatting libraries, with emphasis on lightweight options for optimal performance.

## 1. Day.js ⭐ **RECOMMENDED - Ultra Lightweight**

### Overview
Day.js is a minimalist JavaScript library that parses, validates, manipulates, and displays dates and times with a largely Moment.js-compatible API.

### Bundle Size
- **Core**: ~2kB (minified + gzipped)
- **With plugins**: 3-10kB depending on features used
- **Alternative to**: Moment.js (which is 67kB)

### Key Features
- 🪶 **Ultra lightweight** - Only 2kB core
- 🔌 **Plugin system** - Add only what you need
- 🔄 **Moment.js compatible API** - Easy migration
- 📱 **Mobile-first** - Perfect for web apps
- 🌐 **i18n support** - Multiple locales
- 🚫 **Immutable** - No side effects

### Code Examples
```javascript
import dayjs from 'dayjs'

// Basic formatting
dayjs().format('YYYY-MM-DD HH:mm:ss')
// Output: "2024-01-15 14:30:25"

// Relative time (with plugin)
dayjs().fromNow()
// Output: "a few seconds ago"

// Custom formats
dayjs().format('MMM DD, YYYY')
// Output: "Jan 15, 2024"
```

### Popular Plugins (Optional)
- `relativeTime` - "2 hours ago" formatting
- `customParseFormat` - Custom parsing
- `timezone` - Timezone support
- `utc` - UTC operations

### Pros
✅ Extremely lightweight  
✅ Tree-shakable with plugins  
✅ Great documentation  
✅ Active development  
✅ TypeScript support  

### Cons
❌ Requires plugins for advanced features  
❌ Smaller ecosystem than Moment.js  

---

## 2. date-fns ⭐ **RECOMMENDED - Functional & Lightweight**

### Overview
Modern JavaScript date utility library providing the most comprehensive, yet simple and consistent toolset for manipulating JavaScript dates.

### Bundle Size
- **Per function**: ~300B-2kB each (tree-shakable)
- **Full library**: ~78kB (but you only import what you use)
- **Typical usage**: 5-15kB for common operations

### Key Features
- 🌳 **Tree-shakable** - Import only needed functions
- 🔧 **Functional approach** - Pure functions, no side effects
- 📅 **200+ functions** - Comprehensive date operations
- 🌐 **Full i18n support** - 100+ locales built-in
- ⚡ **Fast performance** - Optimized algorithms
- 🔒 **TypeScript first** - Excellent type safety

### Code Examples
```javascript
import { format, formatDistanceToNow, parseISO } from 'date-fns'

// Basic formatting
format(new Date(), 'yyyy-MM-dd HH:mm:ss')
// Output: "2024-01-15 14:30:25"

// Relative time
formatDistanceToNow(new Date(2024, 0, 1))
// Output: "14 days ago"

// Parse and format
format(parseISO('2024-01-15'), 'MMM do, yyyy')
// Output: "Jan 1st, 2024"
```

### Popular Functions
- `format()` - Date formatting
- `parse()` - String parsing
- `addDays()`, `subDays()` - Date arithmetic
- `isAfter()`, `isBefore()` - Comparisons
- `startOfWeek()`, `endOfMonth()` - Date boundaries

### Pros
✅ Only pay for what you use (tree-shaking)  
✅ Pure functions - predictable behavior  
✅ Excellent TypeScript support  
✅ Comprehensive function library  
✅ Great i18n support  

### Cons
❌ Can be verbose for simple operations  
❌ Larger learning curve  
❌ Function names can be long  

---

## 3. Luxon 

### Overview
Luxon is a library for working with dates and times in JavaScript, created by one of the Moment.js developers as a successor with modern JavaScript features.

### Bundle Size
- **Core**: ~60kB (minified + gzipped)
- **Lighter than**: Moment.js but heavier than Day.js/date-fns
- **Trade-off**: More features built-in vs larger size

### Key Features
- 🌐 **Built-in i18n** - Uses Intl API
- 🕐 **Timezone support** - First-class timezone handling
- 📅 **Duration support** - Time intervals and periods
- 🔄 **Immutable** - All operations return new instances
- ⚡ **Modern APIs** - Uses native Intl formatting
- 🎯 **Precision** - Better handling of edge cases

### Code Examples
```javascript
import { DateTime } from 'luxon'

// Basic formatting
DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss')
// Output: "2024-01-15 14:30:25"

// Timezone aware
DateTime.now().setZone('America/New_York').toFormat('fff')
// Output: "Jan 15, 2024, 2:30:25 PM EST"

// Relative formatting
DateTime.now().minus({ days: 2 }).toRelative()
// Output: "2 days ago"
```

### Advanced Features
- **Duration**: `Duration.fromObject({ hours: 2, minutes: 30 })`
- **Intervals**: `Interval.fromDateTimes(start, end)`
- **Timezone**: Built-in IANA timezone support
- **Parsing**: Robust parsing with format tokens

### Pros
✅ Excellent timezone support  
✅ Built-in internationalization  
✅ Modern JavaScript features  
✅ Great handling of edge cases  
✅ Duration and interval support  

### Cons
❌ Larger bundle size (~60kB)  
❌ Learning curve for API  
❌ Less widespread adoption  

---

## 📊 Quick Comparison

| Library | Bundle Size | Tree Shakable | i18n | Timezone | Learning Curve |
|---------|------------|---------------|------|----------|----------------|
| **Day.js** | 2kB ⭐ | Plugins only | Plugin | Plugin | Easy ⭐ |
| **date-fns** | 5-15kB ⭐ | Yes ⭐ | Built-in | External | Medium |
| **Luxon** | 60kB | No | Built-in | Built-in ⭐ | Hard |

## 🏆 Recommendations

### For Ultra-Lightweight Projects
**Use Day.js** if you need basic date formatting and want the smallest possible bundle size.

### For Modern Applications
**Use date-fns** if you want functional programming approach with tree-shaking and only need specific date operations.

### For Complex Date/Time Applications
**Use Luxon** if you need advanced timezone handling, durations, and don't mind the larger bundle size.

## 🚀 Migration Notes

### From Moment.js
- **Day.js**: Drop-in replacement with similar API
- **date-fns**: Requires refactoring to functional approach
- **Luxon**: Complete API change but more powerful

### Performance Impact
- Day.js: ~65x smaller than Moment.js
- date-fns: ~5x smaller (typical usage)
- Luxon: ~10% smaller than Moment.js

## 📝 Conclusion

For most lightweight applications, **Day.js** offers the best balance of functionality and size. For applications requiring extensive date manipulation with modern JavaScript patterns, **date-fns** provides excellent tree-shaking benefits. Reserve **Luxon** for applications with complex timezone or duration requirements.

Choose based on your specific needs:
- **Size matters most**: Day.js
- **Tree-shaking & functional style**: date-fns  
- **Advanced features**: Luxon