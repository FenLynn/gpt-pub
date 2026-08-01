using Konscious.Security.Cryptography;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PersonalWorkbench;

public sealed class SecurityMetadata
{
    public int SchemaVersion { get; set; } = 1;
    public bool VaultConfigured { get; set; }
    public string PasswordKdf { get; set; } = "Argon2id";
    public int MemorySizeKiB { get; set; } = 65_536;
    public int Iterations { get; set; } = 3;
    public int Parallelism { get; set; } = 1;
    public string Salt { get; set; } = string.Empty;
    public string EnvelopeNonce { get; set; } = string.Empty;
    public string EnvelopeCiphertext { get; set; } = string.Empty;
    public string EnvelopeTag { get; set; } = string.Empty;
    public bool TotpEnabled { get; set; }
    public string TotpIssuer { get; set; } = ProductIdentity.ProductName;
    public string TotpAccount { get; set; } = "Local Vault";
    public bool PinEnabled { get; set; }
    public string PinSalt { get; set; } = string.Empty;
    public string PinHash { get; set; } = string.Empty;
    public int PinIterations { get; set; } = 120_000;
}

internal sealed class SecurityEnvelope
{
    public string DataKey { get; set; } = string.Empty;
    public string TotpSecret { get; set; } = string.Empty;
}

internal sealed class EncryptedPayload
{
    public int SchemaVersion { get; set; } = 1;
    public string Nonce { get; set; } = string.Empty;
    public string Ciphertext { get; set; } = string.Empty;
    public string Tag { get; set; } = string.Empty;
}

public sealed class VaultEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string Secret { get; set; } = string.Empty;
    public string Notes { get; set; } = string.Empty;
    public DateTimeOffset UpdatedUtc { get; set; } = DateTimeOffset.UtcNow;

    public override string ToString() => string.IsNullOrWhiteSpace(Name) ? "未命名项目" : Name;
}

public sealed record SecurityOperationResult(bool Success, string Message)
{
    public static SecurityOperationResult Ok(string message) => new(true, message);
    public static SecurityOperationResult Fail(string message) => new(false, message);
}

public sealed class SecuritySetupDraft : IDisposable
{
    internal SecuritySetupDraft(byte[] rootKey, byte[] dataKey, byte[] totpSecret, byte[] salt, SecurityMetadata metadata)
    {
        RootKey = rootKey;
        DataKey = dataKey;
        TotpSecret = totpSecret;
        Salt = salt;
        Metadata = metadata;
        TotpSecretText = SecurityService.Base32Encode(totpSecret);
        OtpAuthUri = SecurityService.BuildOtpAuthUri(metadata.TotpIssuer, metadata.TotpAccount, TotpSecretText);
    }

    internal byte[] RootKey { get; }
    internal byte[] DataKey { get; }
    internal byte[] TotpSecret { get; }
    internal byte[] Salt { get; }
    internal SecurityMetadata Metadata { get; }
    public string TotpSecretText { get; }
    public string OtpAuthUri { get; }

    public void Dispose()
    {
        CryptographicOperations.ZeroMemory(RootKey);
        CryptographicOperations.ZeroMemory(DataKey);
        CryptographicOperations.ZeroMemory(TotpSecret);
        CryptographicOperations.ZeroMemory(Salt);
    }
}

public static class SecurityService
{
    private const int MasterPasswordMinimumLength = 20;
    private const int AesKeyBytes = 32;
    private const int AesNonceBytes = 12;
    private const int AesTagBytes = 16;
    private const int TotpSecretBytes = 20;
    private static readonly object Sync = new();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private static byte[]? _rootKey;
    private static byte[]? _dataKey;
    private static byte[]? _totpSecret;

    public static string MetadataPath => Path.Combine(App.AppDataDirectory, "security.json");
    public static string VaultPath => Path.Combine(App.AppDataDirectory, "vault.bin");
    public static bool IsConfigured => LoadMetadata().VaultConfigured;
    public static bool IsUnlocked => _dataKey is { Length: AesKeyBytes };
    public static bool IsPinEnabled => LoadMetadata().PinEnabled;

    public static string GetStatusSummary()
    {
        var metadata = LoadMetadata();
        var vault = metadata.VaultConfigured
            ? (IsUnlocked ? "加密保险库已解锁" : "加密保险库已启用")
            : "加密保险库未启用";
        var pin = metadata.PinEnabled ? "四位临时锁已启用" : "四位临时锁未启用";
        return vault + " · " + pin;
    }

    public static async Task<SecuritySetupDraft> CreateSetupDraftAsync(string masterPassword)
    {
        ValidateMasterPassword(masterPassword);
        var metadata = LoadMetadata();
        if (metadata.VaultConfigured)
            throw new InvalidOperationException("加密保险库已经启用。请先解锁现有保险库。");

        metadata.SchemaVersion = 1;
        metadata.VaultConfigured = true;
        metadata.PasswordKdf = "Argon2id";
        metadata.MemorySizeKiB = 65_536;
        metadata.Iterations = 3;
        metadata.Parallelism = 1;
        metadata.TotpEnabled = true;
        metadata.TotpIssuer = ProductIdentity.ProductName;
        metadata.TotpAccount = "Local Vault";

        var salt = RandomNumberGenerator.GetBytes(16);
        var dataKey = RandomNumberGenerator.GetBytes(AesKeyBytes);
        var totpSecret = RandomNumberGenerator.GetBytes(TotpSecretBytes);
        var rootKey = await DeriveRootKeyAsync(masterPassword, salt, metadata);
        return new SecuritySetupDraft(rootKey, dataKey, totpSecret, salt, metadata);
    }

    public static SecurityOperationResult CompleteSetup(SecuritySetupDraft draft, string totpCode)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (!ValidateTotp(draft.TotpSecret, totpCode))
            return SecurityOperationResult.Fail("验证码不正确，请确认手机时间正确后重试。");

        lock (Sync)
        {
            try
            {
                var metadata = draft.Metadata;
                metadata.Salt = Convert.ToBase64String(draft.Salt);
                WriteEnvelope(metadata, draft.RootKey, draft.DataKey, draft.TotpSecret);
                WriteJsonAtomic(MetadataPath, metadata);
                WriteEncryptedVault(draft.DataKey, Array.Empty<VaultEntry>());
                ReplaceUnlockedKeys(draft.RootKey, draft.DataKey, draft.TotpSecret);
                return SecurityOperationResult.Ok("主密码、TOTP 与加密保险库已启用。");
            }
            catch (Exception ex)
            {
                App.Log("Security setup failed: " + ex);
                return SecurityOperationResult.Fail("安全设置写入失败：" + ex.Message);
            }
        }
    }

    public static async Task<SecurityOperationResult> UnlockVaultAsync(string masterPassword, string totpCode)
    {
        var metadata = LoadMetadata();
        if (!metadata.VaultConfigured)
            return SecurityOperationResult.Fail("尚未启用加密保险库。");
        if (string.IsNullOrWhiteSpace(masterPassword))
            return SecurityOperationResult.Fail("请输入主密码。");

        try
        {
            var salt = Convert.FromBase64String(metadata.Salt);
            var rootKey = await DeriveRootKeyAsync(masterPassword, salt, metadata);
            try
            {
                var envelope = DecryptEnvelope(metadata, rootKey);
                var dataKey = Convert.FromBase64String(envelope.DataKey);
                var totpSecret = Convert.FromBase64String(envelope.TotpSecret);
                if (!ValidateTotp(totpSecret, totpCode))
                {
                    CryptographicOperations.ZeroMemory(dataKey);
                    CryptographicOperations.ZeroMemory(totpSecret);
                    return SecurityOperationResult.Fail("主密码或验证码不正确。");
                }
                lock (Sync)
                    ReplaceUnlockedKeys(rootKey, dataKey, totpSecret);
                if (!File.Exists(VaultPath))
                    WriteEncryptedVault(dataKey, Array.Empty<VaultEntry>());
                return SecurityOperationResult.Ok("加密保险库已解锁。");
            }
            finally
            {
                CryptographicOperations.ZeroMemory(rootKey);
            }
        }
        catch (CryptographicException)
        {
            return SecurityOperationResult.Fail("主密码或验证码不正确。");
        }
        catch (Exception ex)
        {
            App.Log("Vault unlock failed: " + ex);
            return SecurityOperationResult.Fail("无法解锁保险库：" + ex.Message);
        }
    }

    public static void LockVault()
    {
        lock (Sync)
        {
            ZeroAndClear(ref _rootKey);
            ZeroAndClear(ref _dataKey);
            ZeroAndClear(ref _totpSecret);
        }
    }

    public static IReadOnlyList<VaultEntry> LoadVaultEntries()
    {
        lock (Sync)
        {
            var key = RequireDataKey();
            if (!File.Exists(VaultPath)) return Array.Empty<VaultEntry>();
            var payload = JsonSerializer.Deserialize<EncryptedPayload>(File.ReadAllText(VaultPath), JsonOptions)
                          ?? throw new InvalidDataException("vault.bin 无法解析。");
            var plain = DecryptPayload(key, payload, "AtlasDeskVault-v1");
            try
            {
                return JsonSerializer.Deserialize<List<VaultEntry>>(plain, JsonOptions)
                       ?? new List<VaultEntry>();
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plain);
            }
        }
    }

    public static void SaveVaultEntries(IEnumerable<VaultEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        lock (Sync)
        {
            var key = RequireDataKey();
            var normalized = entries
                .Where(entry => entry is not null)
                .Select(entry => new VaultEntry
                {
                    Id = entry.Id == Guid.Empty ? Guid.NewGuid() : entry.Id,
                    Name = entry.Name?.Trim() ?? string.Empty,
                    UserName = entry.UserName?.Trim() ?? string.Empty,
                    Secret = entry.Secret ?? string.Empty,
                    Notes = entry.Notes ?? string.Empty,
                    UpdatedUtc = DateTimeOffset.UtcNow
                })
                .OrderBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();
            WriteEncryptedVault(key, normalized);
        }
    }

    public static SecurityOperationResult SetPin(string pin, string confirmation)
    {
        if (!IsValidPin(pin)) return SecurityOperationResult.Fail("四位临时密码必须正好是 4 位数字。");
        if (!string.Equals(pin, confirmation, StringComparison.Ordinal))
            return SecurityOperationResult.Fail("两次输入的四位密码不一致。");
        var metadata = LoadMetadata();
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = DerivePinHash(pin, salt, metadata.PinIterations);
        metadata.PinEnabled = true;
        metadata.PinSalt = Convert.ToBase64String(salt);
        metadata.PinHash = Convert.ToBase64String(hash);
        WriteJsonAtomic(MetadataPath, metadata);
        CryptographicOperations.ZeroMemory(salt);
        CryptographicOperations.ZeroMemory(hash);
        return SecurityOperationResult.Ok("四位临时锁已启用。");
    }

    public static SecurityOperationResult DisablePin(string currentPin)
    {
        if (!VerifyPin(currentPin)) return SecurityOperationResult.Fail("四位密码不正确。");
        var metadata = LoadMetadata();
        metadata.PinEnabled = false;
        metadata.PinSalt = string.Empty;
        metadata.PinHash = string.Empty;
        WriteJsonAtomic(MetadataPath, metadata);
        return SecurityOperationResult.Ok("四位临时锁已关闭。");
    }

    public static bool VerifyPin(string pin)
    {
        var metadata = LoadMetadata();
        if (!metadata.PinEnabled || !IsValidPin(pin)) return false;
        try
        {
            var salt = Convert.FromBase64String(metadata.PinSalt);
            var expected = Convert.FromBase64String(metadata.PinHash);
            var actual = DerivePinHash(pin, salt, metadata.PinIterations);
            try { return CryptographicOperations.FixedTimeEquals(expected, actual); }
            finally
            {
                CryptographicOperations.ZeroMemory(salt);
                CryptographicOperations.ZeroMemory(expected);
                CryptographicOperations.ZeroMemory(actual);
            }
        }
        catch { return false; }
    }

    public static bool ValidateTotpCodeForUnlockedVault(string code)
    {
        lock (Sync)
            return _totpSecret is { Length: > 0 } && ValidateTotp(_totpSecret, code);
    }

    public static SecurityMetadata LoadMetadata()
    {
        try
        {
            if (!File.Exists(MetadataPath)) return new SecurityMetadata();
            return JsonSerializer.Deserialize<SecurityMetadata>(File.ReadAllText(MetadataPath), JsonOptions)
                   ?? new SecurityMetadata();
        }
        catch (Exception ex)
        {
            App.Log("Security metadata load failed: " + ex.Message);
            return new SecurityMetadata();
        }
    }

    internal static string BuildOtpAuthUri(string issuer, string account, string secret)
    {
        var label = Uri.EscapeDataString(issuer + ":" + account);
        return $"otpauth://totp/{label}?secret={secret}&issuer={Uri.EscapeDataString(issuer)}&digits=6&period=30";
    }

    internal static string Base32Encode(ReadOnlySpan<byte> data)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        if (data.Length == 0) return string.Empty;
        var output = new StringBuilder((data.Length * 8 + 4) / 5);
        var buffer = 0;
        var bitsLeft = 0;
        foreach (var value in data)
        {
            buffer = (buffer << 8) | value;
            bitsLeft += 8;
            while (bitsLeft >= 5)
            {
                output.Append(alphabet[(buffer >> (bitsLeft - 5)) & 31]);
                bitsLeft -= 5;
            }
        }
        if (bitsLeft > 0) output.Append(alphabet[(buffer << (5 - bitsLeft)) & 31]);
        return output.ToString();
    }

    private static async Task<byte[]> DeriveRootKeyAsync(string password, byte[] salt, SecurityMetadata metadata)
    {
        return await Task.Run(() =>
        {
            using var argon = new Argon2id(Encoding.UTF8.GetBytes(password))
            {
                Salt = salt,
                DegreeOfParallelism = Math.Clamp(metadata.Parallelism, 1, 4),
                Iterations = Math.Clamp(metadata.Iterations, 2, 10),
                MemorySize = Math.Clamp(metadata.MemorySizeKiB, 19_456, 262_144)
            };
            return argon.GetBytes(AesKeyBytes);
        });
    }

    private static void ValidateMasterPassword(string password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < MasterPasswordMinimumLength)
            throw new ArgumentException($"主密码至少需要 {MasterPasswordMinimumLength} 个字符。", nameof(password));
    }

    private static bool IsValidPin(string pin)
        => pin is { Length: 4 } && pin.All(char.IsDigit);

    private static byte[] DerivePinHash(string pin, byte[] salt, int iterations)
        => Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(pin), salt, Math.Clamp(iterations, 50_000, 500_000),
            HashAlgorithmName.SHA256, 32);

    private static void WriteEnvelope(SecurityMetadata metadata, byte[] rootKey, byte[] dataKey, byte[] totpSecret)
    {
        var envelope = new SecurityEnvelope
        {
            DataKey = Convert.ToBase64String(dataKey),
            TotpSecret = Convert.ToBase64String(totpSecret)
        };
        var plain = JsonSerializer.SerializeToUtf8Bytes(envelope, JsonOptions);
        try
        {
            var payload = EncryptPayload(rootKey, plain, "AtlasDeskSecurity-v1");
            metadata.EnvelopeNonce = payload.Nonce;
            metadata.EnvelopeCiphertext = payload.Ciphertext;
            metadata.EnvelopeTag = payload.Tag;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    private static SecurityEnvelope DecryptEnvelope(SecurityMetadata metadata, byte[] rootKey)
    {
        var payload = new EncryptedPayload
        {
            SchemaVersion = 1,
            Nonce = metadata.EnvelopeNonce,
            Ciphertext = metadata.EnvelopeCiphertext,
            Tag = metadata.EnvelopeTag
        };
        var plain = DecryptPayload(rootKey, payload, "AtlasDeskSecurity-v1");
        try
        {
            return JsonSerializer.Deserialize<SecurityEnvelope>(plain, JsonOptions)
                   ?? throw new CryptographicException("Security envelope is empty.");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    private static void WriteEncryptedVault(byte[] dataKey, IEnumerable<VaultEntry> entries)
    {
        var plain = JsonSerializer.SerializeToUtf8Bytes(entries, JsonOptions);
        try
        {
            var payload = EncryptPayload(dataKey, plain, "AtlasDeskVault-v1");
            WriteJsonAtomic(VaultPath, payload);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    private static EncryptedPayload EncryptPayload(byte[] key, byte[] plain, string associatedData)
    {
        var nonce = RandomNumberGenerator.GetBytes(AesNonceBytes);
        var cipher = new byte[plain.Length];
        var tag = new byte[AesTagBytes];
        using var aes = new AesGcm(key, AesTagBytes);
        aes.Encrypt(nonce, plain, cipher, tag, Encoding.UTF8.GetBytes(associatedData));
        return new EncryptedPayload
        {
            SchemaVersion = 1,
            Nonce = Convert.ToBase64String(nonce),
            Ciphertext = Convert.ToBase64String(cipher),
            Tag = Convert.ToBase64String(tag)
        };
    }

    private static byte[] DecryptPayload(byte[] key, EncryptedPayload payload, string associatedData)
    {
        var nonce = Convert.FromBase64String(payload.Nonce);
        var cipher = Convert.FromBase64String(payload.Ciphertext);
        var tag = Convert.FromBase64String(payload.Tag);
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(key, AesTagBytes);
        aes.Decrypt(nonce, cipher, tag, plain, Encoding.UTF8.GetBytes(associatedData));
        return plain;
    }

    private static bool ValidateTotp(byte[] secret, string code)
    {
        code = new string((code ?? string.Empty).Where(char.IsDigit).ToArray());
        if (code.Length != 6) return false;
        var nowStep = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30;
        for (var offset = -1; offset <= 1; offset++)
        {
            var expected = ComputeTotp(secret, nowStep + offset);
            if (CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(code)))
                return true;
        }
        return false;
    }

    private static string ComputeTotp(byte[] secret, long counter)
    {
        Span<byte> counterBytes = stackalloc byte[8];
        for (var i = 7; i >= 0; i--)
        {
            counterBytes[i] = (byte)(counter & 0xff);
            counter >>= 8;
        }
        using var hmac = new HMACSHA1(secret);
        var hash = hmac.ComputeHash(counterBytes.ToArray());
        var offset = hash[^1] & 0x0f;
        var binary = ((hash[offset] & 0x7f) << 24)
                     | ((hash[offset + 1] & 0xff) << 16)
                     | ((hash[offset + 2] & 0xff) << 8)
                     | (hash[offset + 3] & 0xff);
        return (binary % 1_000_000).ToString("D6");
    }

    private static byte[] RequireDataKey()
        => _dataKey is { Length: AesKeyBytes }
            ? _dataKey
            : throw new InvalidOperationException("加密保险库尚未解锁。");

    private static void ReplaceUnlockedKeys(byte[] rootKey, byte[] dataKey, byte[] totpSecret)
    {
        ZeroAndClear(ref _rootKey);
        ZeroAndClear(ref _dataKey);
        ZeroAndClear(ref _totpSecret);
        _rootKey = rootKey.ToArray();
        _dataKey = dataKey.ToArray();
        _totpSecret = totpSecret.ToArray();
    }

    private static void ZeroAndClear(ref byte[]? value)
    {
        if (value is not null) CryptographicOperations.ZeroMemory(value);
        value = null;
    }

    private static void WriteJsonAtomic<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? App.AppDataDirectory);
        var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(value, JsonOptions), new UTF8Encoding(false));
            File.Move(temp, path, true);
        }
        finally
        {
            try { if (File.Exists(temp)) File.Delete(temp); } catch { }
        }
    }
}
