using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;

namespace LaserBench.BeamSquaredBridge
{
    internal static class Program
    {
        private static object _automation;

        private static int Main(string[] args)
        {
            try
            {
                var assemblyPath = ReadArg(args, "--assembly") ?? FindDefaultAssembly();
                if (string.IsNullOrWhiteSpace(assemblyPath) || !File.Exists(assemblyPath))
                    throw new FileNotFoundException("M2.Automation.dll not found.", assemblyPath);

                var assembly = Assembly.LoadFrom(assemblyPath);
                var type = assembly.GetType("M2.Automation.AutomatedBeamSquared", throwOnError: true);
                _automation = Activator.CreateInstance(type, new object[] { false });
                var status = TryString(TryGetObject(_automation, "RunManager"), "RunStatus");
                Console.WriteLine("READY\t" + B64("BeamSquared Automation; RunStatus=" + status));
                Console.Out.Flush();

                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    var command = line.Trim().ToUpperInvariant();
                    if (command == "PING")
                    {
                        Console.WriteLine("OK\tPING");
                    }
                    else if (command == "SNAPSHOT")
                    {
                        WriteSnapshot();
                    }
                    else if (command == "SHUTDOWN")
                    {
                        Console.WriteLine("OK\tSHUTDOWN");
                        Console.Out.Flush();
                        Shutdown();
                        return 0;
                    }
                    else
                    {
                        Console.WriteLine("ERR\t" + B64("Unknown command: " + line));
                    }
                    Console.Out.Flush();
                }

                Shutdown();
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex);
                try
                {
                    Console.WriteLine("FATAL\t" + B64(ex.GetBaseException().Message));
                    Console.Out.Flush();
                }
                catch { }
                Shutdown();
                return 2;
            }
        }

        private static void WriteSnapshot()
        {
            try
            {
                var rail = TryGetObject(_automation, "RailControl");
                var quantitative = TryGetObject(_automation, "QuantitativeResults");
                var laser = TryGetObject(_automation, "LaserResults");
                var runManager = TryGetObject(_automation, "RunManager");

                var position = TryDouble(rail, "CurrentPosition");
                var widthX = TryDouble(quantitative, "BeamWidthX");
                var widthY = TryDouble(quantitative, "BeamWidthY");
                var m2x = TryDouble(laser, "M2X");
                var m2y = TryDouble(laser, "M2Y");
                var status = TryString(runManager, "RunStatus");

                Console.WriteLine(string.Join("\t", new[]
                {
                    "SNAPSHOT",
                    F(position), F(widthX), F(widthY), F(m2x), F(m2y),
                    B64(status)
                }));
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERR\t" + B64(ex.GetBaseException().Message));
            }
        }

        private static object Get(object target, string property)
        {
            if (target == null) throw new InvalidOperationException("BeamSquared automation object is null: " + property);
            var info = target.GetType().GetProperty(property, BindingFlags.Instance | BindingFlags.Public);
            if (info == null) throw new MissingMemberException(target.GetType().FullName, property);
            return info.GetValue(target, null);
        }

        private static object TryGetObject(object target, string property)
        {
            try { return Get(target, property); }
            catch { return null; }
        }

        private static double TryDouble(object target, string property)
        {
            try
            {
                var value = Get(target, property);
                if (value == null) return double.NaN;
                return Convert.ToDouble(value, CultureInfo.InvariantCulture);
            }
            catch { return double.NaN; }
        }

        private static string TryString(object target, string property)
        {
            try
            {
                var value = Get(target, property);
                return value == null ? string.Empty : Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
            }
            catch { return string.Empty; }
        }
        private static string F(double value) => value.ToString("R", CultureInfo.InvariantCulture);
        private static string B64(string value) => Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));

        private static string ReadArg(string[] args, string name)
        {
            for (var i = 0; i < args.Length - 1; i++)
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                    return args[i + 1];
            return null;
        }

        private static string FindDefaultAssembly()
        {
            var roots = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)
            }.Where(x => !string.IsNullOrWhiteSpace(x));
            foreach (var root in roots)
            {
                var candidate = Path.Combine(root, "Spiricon", "BeamSquared", "M2.Automation.dll");
                if (File.Exists(candidate)) return candidate;
            }
            return string.Empty;
        }

        private static void Shutdown()
        {
            if (_automation == null) return;
            try
            {
                var instance = Get(_automation, "Instance");
                var shutdown = instance.GetType().GetMethod("Shutdown", BindingFlags.Instance | BindingFlags.Public);
                if (shutdown != null) shutdown.Invoke(instance, null);
            }
            catch { }
            _automation = null;
        }
    }
}
